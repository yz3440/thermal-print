/**
 * macOS helpers for images, built on system tools so no binaries ship with the extension:
 * `sips` converts any format the system can read, `osascript` reaches the clipboard.
 * No Raycast imports, so scripts can use these too.
 */
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { decodePng, type RasterImage } from "../core/image";

const run = promisify(execFile);

export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".heic",
  ".heif",
  ".gif",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
  ".pdf",
];

export function isImageFile(file: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

/** Larger images are shrunk by sips before decoding; the print is at most a few hundred dots wide anyway. */
const MAX_DECODE_SIZE = 1600;

function expandHome(file: string): string {
  return file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file;
}

const tempFile = (extension: string) => path.join(os.tmpdir(), `thermal-print-${randomUUID()}${extension}`);

/** A local file for `src`: a path, file:// URL, http(s) URL (downloaded) or data: URI (written out). */
async function localFile(src: string): Promise<{ file: string; temporary: boolean }> {
  if (src.startsWith("file://")) return { file: decodeURIComponent(new URL(src).pathname), temporary: false };
  if (/^https?:\/\//i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`Couldn't download ${src} (${response.status})`);
    const file = tempFile(path.extname(new URL(src).pathname) || ".img");
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
    return { file, temporary: true };
  }
  const data = src.match(/^data:image\/([a-z+]+);base64,(.+)$/i);
  if (data) {
    const file = tempFile(`.${data[1].replace("svg+xml", "svg")}`);
    await writeFile(file, Buffer.from(data[2], "base64"));
    return { file, temporary: true };
  }
  return { file: expandHome(src), temporary: false };
}

async function pixelSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await run("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", file]);
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Not an image: ${path.basename(file)}`);
  return { width, height };
}

/** Loads any image macOS can read (PNG, JPEG, HEIC, GIF, TIFF, WebP, the first page of a PDF…). */
export async function loadImage(src: string): Promise<RasterImage> {
  const { file, temporary } = await localFile(src);
  const png = tempFile(".png");
  try {
    const size = await pixelSize(file);
    const shrink = Math.max(size.width, size.height) > MAX_DECODE_SIZE ? ["-Z", String(MAX_DECODE_SIZE)] : [];
    await run("/usr/bin/sips", ["-s", "format", "png", ...shrink, file, "--out", png]);
    return decodePng(await readFile(png));
  } finally {
    await rm(png, { force: true });
    if (temporary) await rm(file, { force: true });
  }
}

// Writes the clipboard's image data (PNG, or TIFF as screenshots and most apps put it) to argv[0].
// Raycast's Clipboard.read() only returns a path for a copied file, not for pixels on the clipboard,
// so a screenshot has to be fetched from the pasteboard by hand.
const SAVE_CLIPBOARD_IMAGE = `
ObjC.import("AppKit");
function run(argv) {
  const board = $.NSPasteboard.generalPasteboard;
  for (const [type, extension] of [[$.NSPasteboardTypePNG, ".png"], [$.NSPasteboardTypeTIFF, ".tiff"]]) {
    const data = board.dataForType(type);
    if (!data.isNil() && data.writeToFileAtomically(argv[0] + extension, true)) return argv[0] + extension;
  }
  return "";
}`;

/**
 * Saves an image on the clipboard (not a copied file) into `directory` and returns its path. The file is
 * named after its content, so the same screenshot is only kept once.
 */
export async function saveClipboardImage(directory: string): Promise<string | undefined> {
  await mkdir(directory, { recursive: true });
  const base = path.join(directory, `incoming-${randomUUID()}`);
  const { stdout } = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", SAVE_CLIPBOARD_IMAGE, base]);
  const saved = stdout.trim();
  if (!saved) return undefined;
  const hash = createHash("sha1")
    .update(await readFile(saved))
    .digest("hex")
    .slice(0, 16);
  const file = path.join(directory, `clipboard-${hash}${path.extname(saved)}`);
  try {
    await access(file);
    await rm(saved, { force: true });
  } catch {
    await rename(saved, file);
  }
  return file;
}

/** Deletes the files in `directory` that aren't in `keep` and are older than `olderThanMs`. */
export async function pruneDirectory(directory: string, keep: Set<string>, olderThanMs: number): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  const cutoff = Date.now() - olderThanMs;
  for (const name of names) {
    const file = path.join(directory, name);
    if (keep.has(file)) continue;
    try {
      if ((await stat(file)).mtimeMs < cutoff) await rm(file, { force: true });
    } catch {
      // Gone already, or not ours to delete.
    }
  }
}
