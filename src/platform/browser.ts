import type { FileStore, Ports, SecretStore } from "@/core/ports";

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
    }
  },
};

class LocalFiles implements FileStore {
  async read(name: string) {
    return store.get(`hfl:file:${name}`);
  }
  async write(name: string, content: string) {
    store.set(`hfl:file:${name}`, content);
  }
  async append(name: string, content: string) {
    store.set(`hfl:file:${name}`, (store.get(`hfl:file:${name}`) ?? "") + content);
  }
  async location() {
    return "localStorage";
  }
}

class LocalSecrets implements SecretStore {
  async get(key: string) {
    return store.get(`hfl:secret:${key}`);
  }
  async set(key: string, value: string) {
    store.set(`hfl:secret:${key}`, value);
  }
  async delete(key: string) {
    store.remove(`hfl:secret:${key}`);
  }
  async backend() {
    return "memory" as const;
  }
}

export const BROWSER_API_BASE = "/proxy/hetzner/v1";
export const BROWSER_IP_URL = "/proxy/ipify/";

export function browserPorts(): Ports {
  return {
    fetch: (url, init) => fetch(url, init),
    files: new LocalFiles(),
    secrets: new LocalSecrets(),
    now: () => new Date(),
  };
}
