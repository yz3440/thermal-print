import { LocalStorage } from "@raycast/api";
import { Store, type KV } from "../core/store";

const localStorageKV: KV = {
  async get(key) {
    const value = await LocalStorage.getItem<string>(key);
    return value === undefined ? undefined : String(value);
  },
  set: (key, value) => LocalStorage.setItem(key, value),
  remove: (key) => LocalStorage.removeItem(key),
  async entries() {
    return Object.entries(await LocalStorage.allItems()).map(([key, value]) => [key, String(value)]);
  },
};

export const store = new Store(localStorageKV);

let migrated: Promise<void> | undefined;

/** Brings stored data up to the current schema, once per command run. */
export function ready(): Promise<void> {
  migrated ??= store.migrate();
  return migrated;
}
