import { receiptBlocks } from "../core/layout";
import { FALLBACK_MODEL, isModelId, specFor, type PaperSpec } from "../core/models";
import type { PrinterSettings } from "../core/print";
import { renderPreview, type Preview } from "../core/preview";
import { renderDocument, resolveImages } from "../core/render";
import { formatEndpoint, parseAddress } from "../core/transport";
import type { Receipt } from "../core/types";
import { loadImage } from "../platform/macos";
import { printerSettings } from "./settings";
import { store } from "./storage";

/** The paper spec for previews, without talking to the printer: the setting, the detected model, or the fallback. */
export async function previewSpec(settings: PrinterSettings): Promise<PaperSpec> {
  if (isModelId(settings.model)) return specFor(settings.model);
  try {
    const cached = await store.printerCache(formatEndpoint(parseAddress(settings.address)));
    if (cached && isModelId(cached.model)) return specFor(cached.model);
  } catch {
    // No usable address yet.
  }
  return specFor(FALLBACK_MODEL);
}

export interface ReceiptPreview extends Preview {
  markdown: string;
  unsupported: string[];
  /** Image sources that couldn't be loaded. */
  missingImages: string[];
  spec: PaperSpec;
}

/** Lays the receipt out, images and all, and draws the paper exactly as the printer would. */
export async function previewReceipt(receipt: Receipt, settings = printerSettings()): Promise<ReceiptPreview> {
  const spec = await previewSpec(settings);
  const layout = { spec, now: new Date(), label: settings.label, cut: settings.cut, dateOrder: settings.dateOrder };
  const { blocks, missing } = await resolveImages(receiptBlocks(receipt, layout), loadImage);
  const { bytes, unsupported } = renderDocument(blocks, layout);
  const preview = renderPreview(bytes, spec);
  // Half the dot width in points: one printer dot per pixel on a Retina screen.
  const width = Math.round(preview.widthDots / 2) + 8;
  return {
    ...preview,
    spec,
    unsupported,
    missingImages: missing,
    markdown: `![Receipt preview](${preview.dataUri}?raycast-width=${width})`,
  };
}
