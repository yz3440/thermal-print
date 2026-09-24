import { getPreferenceValues } from "@raycast/api";
import type { PrinterSettings } from "../core/print";

export function printerSettings(): PrinterSettings {
  const preferences = getPreferenceValues<Preferences>();
  return {
    address: preferences.printerAddress ?? "",
    model: preferences.printerModel ?? "auto",
    cut: preferences.cutMode ?? "partial",
    label: preferences.label?.trim() || undefined,
    dateOrder: preferences.dateOrder ?? "month-first",
  };
}
