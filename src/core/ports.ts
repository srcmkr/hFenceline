import type { FetchFn } from "./hetzner/client";

export interface FileStore {
  read(name: string): Promise<string | null>;
  write(name: string, content: string): Promise<void>;
  append(name: string, content: string): Promise<void>;
  location(): Promise<string>;
}

export class SecretStoreError extends Error {
  constructor(
    readonly code: "no-keyring" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "SecretStoreError";
  }
}

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { allowFile?: boolean }): Promise<void>;
  delete(key: string): Promise<void>;
  backend(): Promise<"keyring" | "file" | "memory">;
}

export interface Ports {
  fetch: FetchFn;
  files: FileStore;
  secrets: SecretStore;
  now(): Date;
}
