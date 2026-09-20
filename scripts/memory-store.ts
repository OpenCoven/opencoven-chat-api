import type { KeyValueStore } from "../lib/storage";

export class MemoryStore implements KeyValueStore {
  data = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> { return structuredClone(this.data.get(key) as T ?? null); }
  async set(key: string, value: unknown, _ttl: number, onlyIfAbsent = false) {
    if (onlyIfAbsent && this.data.has(key)) return false;
    this.data.set(key, structuredClone(value)); return true;
  }
  async del(key: string) { this.data.delete(key); }
  async release(key: string, token: string) { if (this.data.get(key) === token) this.data.delete(key); }
  async increment(key: string, _ttl: number) {
    const value = Number(this.data.get(key) ?? 0) + 1; this.data.set(key, value); return value;
  }
}
