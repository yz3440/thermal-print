/** The whole print: pick the printer model, lay the receipt out, send it, and log the result. */
import type { DateOrder } from "./dates";
import { receiptBlocks } from "./layout";
import { FALLBACK_MODEL, isModelId, modelFromIdentity, specFor, type PaperSpec } from "./models";
import { renderDocument, resolveImages, type ImageLoader } from "./render";
import type { Source, Store, StoredReceipt } from "./store";
import {
  formatEndpoint,
  parseAddress,
  PrinterError,
  probe,
  sendJob,
  serialize,
  type Endpoint,
  type SendOptions,
} from "./transport";
import type { CutMode, Receipt } from "./types";

export interface PrinterSettings {
  /** "host[:port]" as typed in the preferences. */
  address: string;
  /** "auto" or a preset id. */
  model: string;
  cut: CutMode;
  label?: string;
  dateOrder: DateOrder;
}

export interface PrintJob {
  receipt: Receipt;
  source: Source;
  /** The stored record this job comes from (a draft or pending job), if any. */
  fromId?: string;
}

export type PrintResult =
  | {
      ok: true;
      record: StoredReceipt;
      unsupported: string[];
      missingImages: string[];
      spec: PaperSpec;
      /** False when the model was neither set nor detected, so the 80 mm default layout was used. */
      modelDetected: boolean;
      ms: number;
    }
  /** The job is kept as `record` under Pending, except for settings mistakes, which aren't worth keeping. */
  | { ok: false; record?: StoredReceipt; error: PrinterError; unsupported: string[] };

export interface ResolvedSpec {
  spec: PaperSpec;
  /** False when `spec` is the fallback because nothing was set or detected. */
  detected: boolean;
}

/** The paper spec for the configured model, asking the printer what it is when set to auto-detect. */
export async function resolveSpec(settings: PrinterSettings, store: Store, endpoint: Endpoint): Promise<ResolvedSpec> {
  if (isModelId(settings.model)) return { spec: specFor(settings.model), detected: true };
  const key = formatEndpoint(endpoint);
  const cached = await store.printerCache(key);
  if (cached && isModelId(cached.model)) return { spec: specFor(cached.model), detected: cached.detected };
  try {
    const { identity } = await probe(endpoint);
    const model = modelFromIdentity(identity?.maker, identity?.model);
    const name = [identity?.maker, identity?.model].filter(Boolean).join(" ") || undefined;
    await store.setPrinterCache(key, { model: model ?? FALLBACK_MODEL, detected: !!model, identity: name });
    return { spec: specFor(model ?? FALLBACK_MODEL), detected: !!model };
  } catch {
    // Unreachable: the print attempt below reports it. Don't cache a guess.
    return { spec: specFor(FALLBACK_MODEL), detected: false };
  }
}

export function asPrinterError(error: unknown): PrinterError {
  if (error instanceof PrinterError) return error;
  return new PrinterError("UNREACHABLE", error instanceof Error ? error.message : String(error));
}

export function printReceipt(
  store: Store,
  settings: PrinterSettings,
  job: PrintJob,
  options: { now?: () => Date; send?: SendOptions; loadImage?: ImageLoader } = {},
): Promise<PrintResult> {
  // One conversation with the printer at a time.
  return serialize(async () => {
    const now = options.now?.() ?? new Date();
    let unsupported: string[] = [];
    try {
      const endpoint = parseAddress(settings.address);
      const { spec, detected } = await resolveSpec(settings, store, endpoint);
      const layout = { spec, now, label: settings.label, cut: settings.cut, dateOrder: settings.dateOrder };
      const { blocks, missing } = await resolveImages(receiptBlocks(job.receipt, layout), options.loadImage);
      const encoded = renderDocument(blocks, layout);
      unsupported = encoded.unsupported;
      const sent = await sendJob(endpoint, encoded.bytes, { preflight: spec.language === "esc-pos", ...options.send });
      const record = await store.recordPrinted(job.receipt, { source: job.source, fromId: job.fromId });
      return { ok: true, record, unsupported, missingImages: missing, spec, modelDetected: detected, ms: sent.ms };
    } catch (caught) {
      const error = asPrinterError(caught);
      // A missing or malformed address is a settings problem, not a job to keep.
      if (error.code === "CONFIG") return { ok: false, error, unsupported };
      const record = await store.recordPending(job.receipt, {
        source: job.source,
        error: error.message,
        maybePrinted: error.maybePrinted,
        fromId: job.fromId,
      });
      return { ok: false, record, error, unsupported };
    }
  });
}
