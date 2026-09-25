import type { Tool } from "@raycast/api";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pictureBlocks, type ImageLook } from "../core/layout";
import type { Receipt } from "../core/types";
import { isImageFile } from "../platform/macos";
import { printConfirmation, printFromTool } from "../ui/tools";

type Input = {
  /** Absolute paths of the images to print, one under another: PNG, JPEG, HEIC, GIF, TIFF, WebP, or a PDF (first page). */
  files: string[];
  /** "photo" (default) for pictures, "lineart" for logos, drawings and screenshots of text, "smooth" or "pattern" for other dithering looks. */
  look?: ImageLook;
  /** "full" (default) for the whole paper width, "half" for half of it, or "original" for the image's own size when it fits. */
  size?: "full" | "half" | "original";
  /** Printed under the images. */
  caption?: string;
};

const expandHome = (file: string) => (file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file);

async function receiptFor(input: Input): Promise<Receipt> {
  if (!input.files?.length) throw new Error("There are no images to print.");
  const files: string[] = [];
  for (const given of input.files) {
    const file = expandHome(given.trim());
    if (!isImageFile(file)) throw new Error(`${path.basename(file)} isn't an image the printer can print.`);
    try {
      await access(file);
    } catch {
      throw new Error(`There is no file at ${file}.`);
    }
    files.push(file);
  }
  const names = files.map((file) => path.basename(file)).join(", ");
  return {
    style: "document",
    title: input.caption?.trim() || names,
    body: names,
    blocks: pictureBlocks(files, {
      size: input.size ?? "full",
      look: input.look ?? "photo",
      tone: "normal",
      sideways: false,
      caption: input.caption,
    }),
  };
}

/** Prints image files, dithered for thermal paper. */
export default async function printImage(input: Input) {
  return printFromTool(await receiptFor(input));
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const receipt = await receiptFor(input);
  return printConfirmation(receipt, [
    { name: "Images", value: receipt.body },
    { name: "Look", value: input.look ?? "photo" },
  ]);
};
