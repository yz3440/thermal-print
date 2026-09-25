import { FALLBACK_MODEL, isModelId, modelFromIdentity, type ModelId } from "../core/models";
import { formatEndpoint, parseAddress, probe, serialize, type Probe } from "../core/transport";
import { ready, store } from "./storage";

export interface Check {
  address: string;
  probe: Probe;
  model: ModelId;
  /** False when the model was neither set nor detected and the 80 mm default is in use. */
  detected: boolean;
  /** How the model was chosen, in words. */
  modelSource: string;
}

/** Talks to the printer without printing, and settles which model preset applies. Throws a PrinterError when unreachable. */
export async function checkPrinter(address: string, setting: string): Promise<Check> {
  await ready();
  const endpoint = parseAddress(address);
  const key = formatEndpoint(endpoint);
  const result = await serialize(() => probe(endpoint));
  if (isModelId(setting)) {
    return { address: key, probe: result, model: setting, detected: true, modelSource: "Set in preferences" };
  }
  const detected = modelFromIdentity(result.identity?.maker, result.identity?.model);
  const identity = [result.identity?.maker, result.identity?.model].filter(Boolean).join(" ") || undefined;
  if (result.identity) {
    await store.setPrinterCache(key, { model: detected ?? FALLBACK_MODEL, detected: !!detected, identity });
  }
  const cached = await store.printerCache(key);
  const model = detected ?? (cached && isModelId(cached.model) ? cached.model : FALLBACK_MODEL);
  return {
    address: key,
    probe: result,
    model,
    detected: !!detected,
    modelSource: detected
      ? "Detected"
      : `Not detected${identity ? ` (says “${identity}”)` : ""}, using the 80 mm default`,
  };
}
