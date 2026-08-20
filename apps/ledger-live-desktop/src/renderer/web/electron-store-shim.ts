/**
 * Browser stand-in for `electron-store`.
 *
 * The renderer's `store.ts` persists a few flags (onboarding state, etc.)
 * through ElectronStore, which relies on Node `fs` (via `conf`/`atomically`).
 * In the PWA there is no filesystem, so we back the same get/set/clear surface
 * with localStorage under a namespaced key. `name`/`encryptionKey` options are
 * accepted for compatibility and ignored (localStorage is already device-local
 * and the stored values are non-sensitive).
 */
type WebStoreOptions = {
  name?: string;
  encryptionKey?: string;
  [key: string]: unknown;
};

class WebStore {
  private prefix: string;
  private data: Record<string, unknown>;

  constructor(options: WebStoreOptions = {}) {
    this.prefix = `llw:web:electron-store:${options.name ?? "default"}:`;
    this.data = {};
    try {
      const raw = localStorage.getItem(`${this.prefix}__data__`);
      if (raw) {
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = {};
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(`${this.prefix}__data__`, JSON.stringify(this.data));
    } catch {
      // storage full or unavailable: keep in-memory state only
    }
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (!(key in this.data)) return defaultValue;
    return this.data[key] as T;
  }

  set(key: string, value: unknown): void {
    if (value === undefined) {
      this.delete(key);
      return;
    }
    this.data[key] = value;
    this.persist();
  }

  has(key: string): boolean {
    return key in this.data;
  }

  delete(key: string): void {
    delete this.data[key];
    this.persist();
  }

  clear(): void {
    this.data = {};
    this.persist();
  }

  get size(): number {
    return Object.keys(this.data).length;
  }

  get store(): Record<string, unknown> {
    return this.data;
  }

  get path(): string {
    return "";
  }
}

export default WebStore;
