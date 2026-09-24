/**
 * What the extension remembers: to-do lists, drafts, print history, pending jobs and detected
 * printer models. Works over any key-value store (Raycast LocalStorage in the app, a Map in tests),
 * one key per record so commands running side by side don't overwrite each other.
 */
import type { Due } from "./dates";
import { withoutRasters, type Block } from "./document";
import type { ChecklistItem, Receipt, Style } from "./types";

export interface KV {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  entries(): Promise<[string, string][]>;
}

export const SCHEMA_VERSION = 2;
/** Unpinned history entries kept; older ones are deleted. */
export const HISTORY_LIMIT = 200;
export const DEFAULT_LIST_NAME = "To-Do";

export type RecordKind = "list" | "draft" | "history" | "pending";
export type Source = "list" | "compose" | "selection" | "image" | "library" | "status";

export interface ListItem {
  id: string;
  text: string;
  due?: Due;
  done?: boolean;
  doneAt?: string;
}

export interface StoredReceipt {
  id: string;
  kind: RecordKind;
  style: Style;
  title?: string;
  /** The receipt text. Lists keep their tasks in `items` instead. */
  body: string;
  /** A list's tasks, or the tasks a history entry printed. */
  items?: ListItem[];
  /** The content of a "document" receipt, with images kept by path. */
  blocks?: Block[];
  pinned?: boolean;
  source: Source;
  createdAt: string;
  updatedAt: string;
  printedAt?: string;
  /** Pending jobs: why printing failed. */
  error?: string;
  /** Pending jobs: part of it may have printed. */
  maybePrinted?: boolean;
}

export interface PrinterCache {
  model: string;
  /** False when the printer didn't say what it is and a fallback preset is in use. */
  detected: boolean;
  identity?: string;
}

const RECORD = "rec:";
const PRINTER = "printer:";
const DEFAULT_LIST = "list:default";
const SCHEMA = "schema";

/** Time-sortable ids: base-36 milliseconds plus a random tail. */
export function newId(now = Date.now()): string {
  return now.toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

export const openItems = (items: ListItem[] = []) => items.filter((item) => !item.done);

const toChecklist = (items: ListItem[]): ChecklistItem[] =>
  items.map((item) => ({ text: item.text, checked: !!item.done, depth: 0, due: item.due }));

/** Plain-text version of tasks, for copying and for the body of history entries. */
export function itemsMarkdown(items: ListItem[]): string {
  return items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n");
}

/** What printing a record prints. A list prints its open tasks. */
export function receiptOf(record: StoredReceipt): Receipt {
  if (record.kind === "list") {
    const open = openItems(record.items);
    return { style: "checklist", title: record.title, body: itemsMarkdown(open), items: toChecklist(open) };
  }
  if (record.items) {
    return { style: record.style, title: record.title, body: record.body, items: toChecklist(record.items) };
  }
  return { style: record.style, title: record.title, body: record.body, blocks: record.blocks };
}

const snapshot = (receipt: Receipt): ListItem[] | undefined =>
  receipt.items?.map((item) => ({ id: newId(), text: item.text, due: item.due, done: item.checked || undefined }));

const storedBlocks = (receipt: Receipt): Block[] | undefined => receipt.blocks && withoutRasters(receipt.blocks);

export class Store {
  constructor(
    private readonly kv: KV,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async migrate(): Promise<void> {
    const version = Number(await this.kv.get(SCHEMA)) || 0;
    if (version >= SCHEMA_VERSION) return;
    // Version 1 numbered one ticket per task; version 2 prints whole lists.
    if (version < 2) await this.kv.remove("seq:ticket");
    await this.kv.set(SCHEMA, String(SCHEMA_VERSION));
  }

  /** Every record, newest first. */
  async all(): Promise<StoredReceipt[]> {
    const records: StoredReceipt[] = [];
    for (const [key, value] of await this.kv.entries()) {
      if (!key.startsWith(RECORD)) continue;
      try {
        records.push(JSON.parse(value) as StoredReceipt);
      } catch {
        // A damaged record shouldn't hide the rest.
      }
    }
    return records.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  async get(id: string): Promise<StoredReceipt | undefined> {
    const value = await this.kv.get(RECORD + id);
    return value ? (JSON.parse(value) as StoredReceipt) : undefined;
  }

  async save(record: StoredReceipt): Promise<StoredReceipt> {
    const saved = { ...record, updatedAt: this.clock().toISOString() };
    await this.kv.set(RECORD + saved.id, JSON.stringify(saved));
    return saved;
  }

  async create(fields: Omit<StoredReceipt, "id" | "createdAt" | "updatedAt">): Promise<StoredReceipt> {
    const now = this.clock();
    const record: StoredReceipt = {
      ...fields,
      id: newId(now.getTime()),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await this.kv.set(RECORD + record.id, JSON.stringify(record));
    return record;
  }

  async remove(id: string): Promise<void> {
    await this.kv.remove(RECORD + id);
    if ((await this.kv.get(DEFAULT_LIST)) === id) await this.kv.remove(DEFAULT_LIST);
  }

  async lists(): Promise<StoredReceipt[]> {
    return (await this.all()).filter((record) => record.kind === "list");
  }

  async createList(name: string, items: Omit<ListItem, "id">[] = []): Promise<StoredReceipt> {
    return this.create({
      kind: "list",
      style: "checklist",
      title: name.trim(),
      body: "",
      items: items.map((item) => ({ ...item, id: newId() })),
      source: "library",
    });
  }

  /** The list tasks go to when no other list is named, created on first use. */
  async defaultList(): Promise<StoredReceipt> {
    const id = await this.kv.get(DEFAULT_LIST);
    const current = id ? await this.get(id) : undefined;
    if (current?.kind === "list") return current;
    const list = await this.createList(DEFAULT_LIST_NAME);
    await this.kv.set(DEFAULT_LIST, list.id);
    return list;
  }

  async setDefaultList(id: string): Promise<void> {
    await this.kv.set(DEFAULT_LIST, id);
  }

  async isDefaultList(id: string): Promise<boolean> {
    return (await this.kv.get(DEFAULT_LIST)) === id;
  }

  private async editList(listId: string, edit: (items: ListItem[]) => ListItem[]): Promise<StoredReceipt> {
    const list = await this.get(listId);
    if (!list || list.kind !== "list") throw new Error("That list no longer exists.");
    return this.save({ ...list, items: edit(list.items ?? []) });
  }

  async addToList(listId: string, text: string, due?: Due): Promise<StoredReceipt> {
    return this.editList(listId, (items) => [...items, { id: newId(), text: text.trim(), due }]);
  }

  async updateItem(listId: string, itemId: string, patch: Partial<Omit<ListItem, "id">>): Promise<StoredReceipt> {
    return this.editList(listId, (items) => items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }

  async setDone(listId: string, itemId: string, done: boolean): Promise<StoredReceipt> {
    return this.updateItem(listId, itemId, done ? { done, doneAt: this.clock().toISOString() } : { done: false });
  }

  async removeItem(listId: string, itemId: string): Promise<StoredReceipt> {
    return this.editList(listId, (items) => items.filter((item) => item.id !== itemId));
  }

  async clearDone(listId: string): Promise<StoredReceipt> {
    return this.editList(listId, (items) => items.filter((item) => !item.done));
  }

  async clearList(listId: string): Promise<StoredReceipt> {
    return this.editList(listId, () => []);
  }

  /** Logs a successful print. A pending job becomes the history entry; anything else gets a new one. */
  async recordPrinted(receipt: Receipt, details: { source: Source; fromId?: string }): Promise<StoredReceipt> {
    const printedAt = this.clock().toISOString();
    const from = details.fromId ? await this.get(details.fromId) : undefined;
    let record: StoredReceipt;
    if (from?.kind === "pending") {
      const done: StoredReceipt = { ...from, kind: "history", printedAt };
      delete done.error;
      delete done.maybePrinted;
      record = await this.save(done);
    } else {
      if (from && (from.kind === "list" || from.kind === "draft")) await this.save({ ...from, printedAt });
      record = await this.create({
        kind: "history",
        style: receipt.style,
        title: receipt.title,
        body: receipt.body,
        items: snapshot(receipt),
        blocks: storedBlocks(receipt),
        source: details.source,
        printedAt,
      });
    }
    await this.pruneHistory();
    return record;
  }

  /** Keeps a job that couldn't print, so it can be printed later. */
  async recordPending(
    receipt: Receipt,
    details: { source: Source; error: string; maybePrinted: boolean; fromId?: string },
  ): Promise<StoredReceipt> {
    const from = details.fromId ? await this.get(details.fromId) : undefined;
    if (from?.kind === "pending") {
      return this.save({ ...from, error: details.error, maybePrinted: details.maybePrinted });
    }
    return this.create({
      kind: "pending",
      style: receipt.style,
      title: receipt.title,
      body: receipt.body,
      items: snapshot(receipt),
      blocks: storedBlocks(receipt),
      source: details.source,
      error: details.error,
      maybePrinted: details.maybePrinted,
    });
  }

  async pruneHistory(): Promise<void> {
    const history = (await this.all()).filter((record) => record.kind === "history" && !record.pinned);
    for (const record of history.slice(HISTORY_LIMIT)) await this.remove(record.id);
  }

  async printerCache(address: string): Promise<PrinterCache | undefined> {
    const value = await this.kv.get(PRINTER + address);
    return value ? (JSON.parse(value) as PrinterCache) : undefined;
  }

  async setPrinterCache(address: string, cache: PrinterCache): Promise<void> {
    await this.kv.set(PRINTER + address, JSON.stringify(cache));
  }

  async clearPrinterCache(address: string): Promise<void> {
    await this.kv.remove(PRINTER + address);
  }
}
