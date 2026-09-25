import { openExtensionPreferences, showHUD, showToast, Toast } from "@raycast/api";
import type { PrintResult } from "../core/print";

type Failure = Extract<PrintResult, { ok: false }>;

export function printedTitle(what?: string): string {
  return what ? `Printed ${what}` : "Printed";
}

export function unsupportedNote(unsupported: string[]): string | undefined {
  if (unsupported.length === 0) return undefined;
  const plural = unsupported.length === 1 ? "character" : "characters";
  return `${unsupported.length} ${plural} printed as “?”: ${unsupported.join(" ")}`;
}

export const MODEL_HINT =
  "The printer didn't say what model it is, so the 80 mm default layout was used. If lines wrap oddly, pick your printer under Printer Model in the preferences.";

function failureMessage(result: Failure): string {
  const partial = result.error.maybePrinted ? " Part of it may have printed." : "";
  return [result.error.message + partial, result.error.hint].filter(Boolean).join(" ");
}

const SETTINGS_PROBLEMS = new Set(["CONFIG", "UNREACHABLE", "TIMEOUT", "REFUSED"]);

/** Shows how a print went, reusing `toast` (usually the "Printing…" one) when given. */
export async function showPrintResult(result: PrintResult, what?: string, toast?: Toast): Promise<void> {
  const target = toast ?? (await showToast({ title: "" }));
  if (result.ok) {
    target.style = Toast.Style.Success;
    target.title = printedTitle(what);
    target.message = [unsupportedNote(result.unsupported), result.modelDetected ? undefined : MODEL_HINT]
      .filter(Boolean)
      .join(" ");
    return;
  }
  target.style = Toast.Style.Failure;
  target.title = result.record ? "Not printed, saved to Pending" : "Not printed";
  target.message = failureMessage(result);
  target.primaryAction = SETTINGS_PROBLEMS.has(result.error.code)
    ? { title: "Open Preferences", onAction: () => openExtensionPreferences() }
    : undefined;
}

/**
 * For no-view commands: a HUD on success (which closes Raycast), a toast that stays
 * readable on failure.
 */
export async function announcePrintResult(result: PrintResult, what: string, toast?: Toast): Promise<void> {
  if (result.ok) {
    const note = result.unsupported.length ? ` (${result.unsupported.length} printed as “?”)` : "";
    await showHUD(`${printedTitle(what)}${note}`);
  } else {
    await showPrintResult(result, what, toast);
  }
}

export function printingToast(what = "Printing…"): Promise<Toast> {
  return showToast({ style: Toast.Style.Animated, title: what });
}
