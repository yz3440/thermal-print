/** Shared pieces of the AI tools: a confirmation that shows the receipt, and printing without a UI. */
import { environment, type Tool } from "@raycast/api";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Receipt } from "../core/types";
import { pruneDirectory } from "../platform/macos";
import { MODEL_HINT, unsupportedNote } from "./feedback";
import { previewReceipt } from "./preview";
import { print } from "./printing";
import { ready } from "./storage";

export type Confirmation = NonNullable<Awaited<ReturnType<Tool.Confirmation<unknown>>>>;

/** Preview images for confirmations; each is only needed while its confirmation is on screen. */
const previews = path.join(environment.supportPath, "previews");
const PREVIEW_AGE_MS = 10 * 60 * 1000;

/** Asks before using paper, showing the receipt exactly as it will print. */
export async function printConfirmation(receipt: Receipt, info: Confirmation["info"] = []): Promise<Confirmation> {
  await ready();
  const preview = await previewReceipt(receipt);
  await mkdir(previews, { recursive: true });
  const file = path.join(previews, `${Date.now()}.png`);
  await writeFile(file, preview.png);
  pruneDirectory(previews, new Set([file]), PREVIEW_AGE_MS).catch(() => undefined);
  return {
    message: "Print this receipt?",
    image: file,
    info: [
      ...info,
      { name: "Paper", value: `${(preview.lengthMm / 10).toFixed(1)} cm` },
      { name: "Printer", value: preview.spec.name },
      { name: "Prints as ?", value: preview.unsupported.join(" ") || undefined },
      { name: "Missing images", value: preview.missingImages.join(", ") || undefined },
    ],
  };
}

export interface Printed {
  printed: true;
  printer: string;
  /** Things worth passing on to the user, like characters that printed as "?". */
  notes: string[];
}

/** Prints, or throws with the reason and what to do about it. Failed jobs are kept under Pending. */
export async function printFromTool(receipt: Receipt): Promise<Printed> {
  await ready();
  const result = await print({ receipt, source: "ai" });
  if (!result.ok) {
    const kept = result.record ? " The receipt is kept under Pending in the Receipt Library." : "";
    throw new Error([result.error.message, result.error.hint].filter(Boolean).join(" ") + kept);
  }
  const notes = [
    unsupportedNote(result.unsupported),
    result.missingImages.length
      ? `Couldn't read ${result.missingImages.join(", ")}; the file names were printed instead.`
      : undefined,
    result.modelDetected ? undefined : MODEL_HINT,
  ].filter((note): note is string => !!note);
  return { printed: true, printer: result.spec.name, notes };
}
