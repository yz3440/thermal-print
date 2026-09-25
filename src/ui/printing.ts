import { environment } from "@raycast/api";
import path from "node:path";
import { printReceipt, type PrintJob, type PrintResult } from "../core/print";
import { loadImage, pruneDirectory } from "../platform/macos";
import { printerSettings } from "./settings";
import { store } from "./storage";

/** Where clipboard images are kept, so history entries can print them again. */
export const clipboardImages = path.join(environment.supportPath, "clipboard");

/** Clipboard images no record refers to any more are deleted once they're this old. */
const CLIPBOARD_IMAGE_AGE_MS = 60 * 60 * 1000;

/** Prints with the current preferences, loading any images with macOS's own tools. */
export async function print(job: PrintJob): Promise<PrintResult> {
  const result = await printReceipt(store, printerSettings(), job, { loadImage });
  pruneClipboardImages().catch(() => undefined);
  return result;
}

/** History is capped, so the clipboard images that history no longer mentions can go too. */
async function pruneClipboardImages(): Promise<void> {
  const keep = new Set<string>();
  for (const record of await store.all()) {
    for (const block of record.blocks ?? []) {
      if (block.type === "image" && block.src) keep.add(block.src);
    }
  }
  await pruneDirectory(clipboardImages, keep, CLIPBOARD_IMAGE_AGE_MS);
}
