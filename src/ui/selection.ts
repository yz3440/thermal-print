import { Clipboard, getSelectedFinderItems, getSelectedText } from "@raycast/api";
import { fileURLToPath } from "node:url";
import { isImageFile, saveClipboardImage } from "../platform/macos";
import { clipboardImages } from "./printing";

export type SourceContent =
  | { kind: "text"; text: string; from: "selection" | "clipboard" }
  | { kind: "images"; files: string[]; from: "Finder" | "clipboard" }
  /** Finder is in front with files selected, but none of them are images. */
  | { kind: "other-files" };

/**
 * What to print, in order: images selected in Finder, text selected in the frontmost app, an image file
 * copied to the clipboard, clipboard text, then image data on the clipboard (a screenshot, say).
 */
export async function readSelectionOrClipboard(): Promise<SourceContent | undefined> {
  try {
    const items = await getSelectedFinderItems();
    if (items.length) {
      const files = items.map((item) => item.path).filter(isImageFile);
      return files.length ? { kind: "images", files, from: "Finder" } : { kind: "other-files" };
    }
  } catch {
    // Finder isn't the frontmost app.
  }
  try {
    const selected = await getSelectedText();
    if (selected.trim()) return { kind: "text", text: selected, from: "selection" };
  } catch {
    // Nothing selected, or the app doesn't expose its selection.
  }
  const clipboard = await Clipboard.read();
  if (clipboard.file) {
    const file = clipboard.file.startsWith("file://") ? fileURLToPath(clipboard.file) : clipboard.file;
    if (isImageFile(file)) return { kind: "images", files: [file], from: "clipboard" };
  }
  if (!clipboard.file && clipboard.text?.trim()) return { kind: "text", text: clipboard.text, from: "clipboard" };
  const image = await saveClipboardImage(clipboardImages);
  return image ? { kind: "images", files: [image], from: "clipboard" } : undefined;
}
