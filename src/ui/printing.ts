import { environment } from "@raycast/api";
import path from "node:path";
import { printReceipt, type PrintJob, type PrintResult } from "../core/print";
import { loadImage } from "../platform/macos";
import { printerSettings } from "./settings";
import { store } from "./storage";

/** Prints with the current preferences, loading any images with macOS's own tools. */
export function print(job: PrintJob): Promise<PrintResult> {
  return printReceipt(store, printerSettings(), job, { loadImage });
}

/** Where clipboard images are kept, so history entries can print them again. */
export const clipboardImages = path.join(environment.supportPath, "clipboard");
