/** Printer presets, from the encoder's own printer database (see scripts/gen-models.ts). */
import { CODEPAGE_SETS, MODELS } from "./models.generated";

export type ModelId = keyof typeof MODELS;

/** Used when auto-detect gets no answer: 42 columns fits every 80 mm printer. */
export const FALLBACK_MODEL: ModelId = "epson-tm-t88v";

export interface PaperSpec {
  model: ModelId;
  name: string;
  language: "esc-pos" | "star-prnt" | "star-line";
  codepageMapping: string;
  codepages: readonly string[];
  /** Characters per line in font A. */
  columns: number;
  /** Print width in dots: font A is 12 dots wide, rounded up to whole bytes for images. */
  widthDots: number;
  dpi: number;
  /** Lines fed before a cut, so the last line clears the cutter. */
  cutFeed: number;
}

export function isModelId(id: string): id is ModelId {
  return Object.hasOwn(MODELS, id);
}

export function specFor(model: ModelId): PaperSpec {
  const info = MODELS[model];
  return {
    model,
    name: info.name,
    language: info.language,
    codepageMapping: info.codepageMapping,
    codepages: CODEPAGE_SETS[info.codepageSet],
    columns: info.columns,
    widthDots: Math.ceil((info.columns * 12) / 8) * 8,
    dpi: info.dpi,
    cutFeed: info.cutFeed,
  };
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Maps a GS I identity ("EPSON", "TM-T88V") to a preset, if there is one. */
export function modelFromIdentity(maker: string | undefined, model: string | undefined): ModelId | undefined {
  if (!model) return undefined;
  const wanted = normalize(model);
  const vendor = maker ? normalize(maker) : undefined;
  const matches = (Object.keys(MODELS) as ModelId[]).filter((id) => {
    const info = MODELS[id];
    return normalize(info.model) === wanted && (!vendor || !info.vendor || normalize(info.vendor) === vendor);
  });
  return matches[0];
}
