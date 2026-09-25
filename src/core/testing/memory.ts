import type { FileStore, SecretStore } from "../ports";

export class MemoryFiles implements FileStore {
  readonly files = new Map<string, string>();
  async read(name: string) {
    return this.files.get(name) ?? null;
  }
  async write(name: string, content: string) {
    this.files.set(name, content);
  }
  async append(name: string, content: string) {
    this.files.set(name, (this.files.get(name) ?? "") + content);
  }
  async location() {
    return "(Speicher)";
  }
}

export class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async backend() {
    return "memory" as const;
  }
}
