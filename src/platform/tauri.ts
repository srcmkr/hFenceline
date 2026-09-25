import { invoke } from "@tauri-apps/api/core";
import { configDir, join } from "@tauri-apps/api/path";
import { BaseDirectory, exists, mkdir, readTextFile, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { FetchFn } from "@/core/hetzner/client";
import { SecretStoreError, type FileStore, type Ports, type SecretStore } from "@/core/ports";

const DIR = "hfenceline";
const baseDir = BaseDirectory.Config;

class TauriFiles implements FileStore {
  private ready: Promise<void> | null = null;

  private ensureDir() {
    this.ready ??= mkdir(DIR, { baseDir, recursive: true }).catch(async (e) => {
      if (!(await exists(DIR, { baseDir }))) throw e;
    });
    return this.ready;
  }

  async read(name: string) {
    const path = `${DIR}/${name}`;
    if (!(await exists(path, { baseDir }))) return null;
    return readTextFile(path, { baseDir });
  }

  async write(name: string, content: string) {
    await this.ensureDir();
    const tmp = `${DIR}/${name}.tmp`;
    await writeTextFile(tmp, content, { baseDir });
    await rename(tmp, `${DIR}/${name}`, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir });
  }

  async append(name: string, content: string) {
    await this.ensureDir();
    await writeTextFile(`${DIR}/${name}`, content, { baseDir, append: true });
  }

  async location() {
    return join(await configDir(), DIR);
  }
}

class TauriSecrets implements SecretStore {
  async get(key: string) {
    return invoke<string | null>("secret_get", { key });
  }
  async set(key: string, value: string, opts?: { allowFile?: boolean }) {
    try {
      await invoke("secret_set", { key, value, allowFile: opts?.allowFile ?? false });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("no-keyring")) throw new SecretStoreError("no-keyring", msg);
      throw new SecretStoreError("failed", msg);
    }
  }
  async delete(key: string) {
    await invoke("secret_delete", { key });
  }
  async backend() {
    return invoke<"keyring" | "file">("secret_backend");
  }
}

export function tauriPorts(): Ports {
  return {
    fetch: tauriFetch as unknown as FetchFn,
    files: new TauriFiles(),
    secrets: new TauriSecrets(),
    now: () => new Date(),
  };
}
