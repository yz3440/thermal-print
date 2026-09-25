/**
 * What the extension remembers: drafts, print history, pending jobs and detected printer models.
 * Works over any key-value store (Raycast LocalStorage in the app, a Map in tests), one key per
 * record so commands running side by side don't overwrite each other.
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

export const SCHEMA_VERSION = 3;
/** Unpinned history entries kept; older ones are deleted. */
export const HISTORY_LIMIT = 200;

export type RecordKind = "draft" | "history" | "pending";
export type Source = "compose" | "selection" | "image" | "library" | "status" | "ai";

/** A checklist item as kept in a record, with the due date it was printed with. */
export interface StoredItem {
  id: string;
  text: string;
  due?: Due;
  done?: boolean;
}

export interface StoredReceipt {
  id: string;
  kind: RecordKind;
  style: Style;
  title?: string;
  /** The receipt text. */
  body: string;
  /** The items of a checklist that came with due dates, so a reprint groups them the same way. */
  items?: StoredItem[];
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
const SCHEMA = "schema";

/** Time-sortable ids: base-36 milliseconds plus a random tail. */
export function newId(now = Date.now()): string {
  return now.toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

const toChecklist = (items: StoredItem[]): ChecklistItem[] =>
  items.map((item) => ({ text: item.text, checked: !!item.done, depth: 0, due: item.due }));

const dueText = (due?: Due) => (due ? ` ${due.date}${due.time ? ` ${due.time}` : ""}` : "");

/**
 * Plain-text version of items, for copying and for editing. Due dates go at the end of the line as
 * "2026-09-30 15:00", which checklistFromText reads back.
 */
export function itemsMarkdown(items: Pick<StoredItem, "text" | "due" | "done">[]): string {
  return items.map((item) => `- [${item.done ? "x" : " "}] ${item.text}${dueText(item.due)}`).join("\n");
}

/** What printing a record prints. Items win over the text when a record has both. */
export function receiptOf(record: StoredReceipt): Receipt {
  if (record.items) {
    return { style: record.style, title: record.title, body: record.body, items: toChecklist(record.items) };
  }
  return { style: record.style, title: record.title, body: record.body, blocks: record.blocks };
}

const snapshot = (receipt: Receipt): StoredItem[] | undefined =>
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
    // Version 1 numbered one ticket per task; version 2 printed whole lists.
    if (version < 2) await this.kv.remove("seq:ticket");
    // Version 3 dropped the built-in to-do lists: each list becomes a draft of its open tasks.
    if (version < 3) {
      for (const record of await this.all()) {
        if ((record.kind as string) !== "list") continue;
        const open = (record.items ?? []).filter((item) => !item.done);
        if (open.length === 0) {
          await this.kv.remove(RECORD + record.id);
          continue;
        }
        const items = open.map(({ id, text, due }) => ({ id, text, due }));
        await this.save({ ...record, kind: "draft", style: "checklist", body: itemsMarkdown(items), items });
      }
      await this.kv.remove("list:default");
    }
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
      if (from?.kind === "draft") await this.save({ ...from, printedAt });
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
