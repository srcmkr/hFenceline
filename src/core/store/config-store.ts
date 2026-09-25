import { Document, isMap, isScalar, isSeq, parseDocument, visit, type Node, type Pair, type YAMLMap } from "yaml";
import { ConfigSchema, validateConfig, type Config } from "../model/config";
import type { FileStore } from "../ports";

export const CONFIG_FILE = "config.yaml";

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Konfiguration ungültig:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export class ConfigStore {
  private doc: Document | null = null;

  constructor(
    private readonly files: FileStore,
    private readonly name = CONFIG_FILE,
  ) {}

  async load(): Promise<Config | null> {
    const text = await this.files.read(this.name);
    if (text === null || text.trim() === "") return null;
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new ConfigError(doc.errors.map((e) => e.message));
    const parsed = ConfigSchema.safeParse(doc.toJS());
    if (!parsed.success) {
      throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "(Wurzel)"}: ${i.message}`));
    }
    const problems = validateConfig(parsed.data);
    if (problems.length > 0) throw new ConfigError(problems);
    this.doc = doc;
    return parsed.data;
  }

  async save(config: Config): Promise<void> {
    const problems = validateConfig(config);
    if (problems.length > 0) throw new ConfigError(problems);
    const plain = JSON.parse(JSON.stringify(config)) as unknown;
    let doc = this.doc;
    if (doc && isMap(doc.contents)) {
      doc.contents = updateNode(doc, doc.contents, plain) as YAMLMap;
    } else {
      doc = new Document(plain);
      applyStyle(doc);
    }
    this.doc = doc;
    await this.files.write(this.name, doc.toString({ lineWidth: 0 }));
  }

  async raw(): Promise<string | null> {
    return this.files.read(this.name);
  }
}

const IDENTITY_KEYS = ["id", "hetzner_id", "cidr"] as const;

function identity(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const k of IDENTITY_KEYS) {
    const v = (value as Record<string, unknown>)[k];
    if (v !== undefined) return `${k}=${String(v)}`;
  }
  return undefined;
}

function nodeIdentity(node: unknown): string | undefined {
  if (!isMap(node)) return undefined;
  for (const k of IDENTITY_KEYS) {
    const v = node.get(k);
    if (v !== undefined) return `${k}=${String(v)}`;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function updateNode(doc: Document, node: unknown, value: unknown): unknown {
  if (isPlainObject(value) && isMap(node)) {
    const keep = new Set(Object.keys(value));
    node.items = node.items.filter((pair: Pair) => keep.has(String(isScalar(pair.key) ? pair.key.value : pair.key)));
    for (const [k, v] of Object.entries(value)) {
      const pair = node.items.find((p: Pair) => String(isScalar(p.key) ? p.key.value : p.key) === k);
      if (pair) pair.value = updateNode(doc, pair.value, v) as Node;
      else {
        const created = doc.createNode(v);
        styleNew(created, k, node.flow ?? false);
        node.set(k, created);
      }
    }
    return node;
  }
  if (Array.isArray(value) && isSeq(node)) {
    const old = [...node.items];
    const used = new Set<number>();
    const flowItems = old.some((n) => isMap(n) && n.flow);
    node.items = value.map((v, i) => {
      const id = identity(v);
      let idx = id !== undefined ? old.findIndex((n, j) => !used.has(j) && nodeIdentity(n) === id) : -1;
      if (idx < 0 && id === undefined && i < old.length && !used.has(i)) idx = i;
      if (idx >= 0) {
        used.add(idx);
        return updateNode(doc, old[idx], v);
      }
      const created = doc.createNode(v);
      if (flowItems && isMap(created)) created.flow = true;
      return created;
    }) as typeof node.items;
    return node;
  }
  if (isScalar(node) && (value === null || typeof value !== "object")) {
    if (node.value !== value) node.value = value;
    return node;
  }
  return doc.createNode(value);
}

const FLOW_LISTS = new Set(["rules", "static_ips", "extra_rules"]);
const FLOW_MAPS = new Set(["blocks"]);

function styleNew(node: unknown, key: string, parentFlow: boolean) {
  if (parentFlow) return;
  if (isSeq(node) && FLOW_LISTS.has(key)) {
    for (const item of node.items) if (isMap(item)) item.flow = true;
  }
  if (isMap(node) && FLOW_MAPS.has(key) && node.items.every((p) => isScalar(p.value))) node.flow = true;
  if (isSeq(node) && key === "from") node.flow = true;
}

function applyStyle(doc: Document) {
  visit(doc, {
    Pair(_, pair) {
      const key = isScalar(pair.key) ? String(pair.key.value) : "";
      styleNew(pair.value, key, false);
    },
  });
}
