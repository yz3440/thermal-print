import type { KV } from "../../src/core/store";

export class MemoryKV implements KV {
  readonly map = new Map<string, string>();

  async get(key: string) {
    return this.map.get(key);
  }

  async set(key: string, value: string) {
    this.map.set(key, value);
  }

  async remove(key: string) {
    this.map.delete(key);
  }

  async entries() {
    return [...this.map.entries()];
  }
}
