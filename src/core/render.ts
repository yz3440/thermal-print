/** Turns a document (a list of blocks) into printer bytes. */
import ReceiptPrinterEncoder from "@point-of-sale/receipt-printer-encoder";
import { mapTexts, textsOf, type Align, type Block, type ImageBlock, type ListEntry } from "./document";
import { prepareImage, type RasterImage } from "./image";
import type { PaperSpec } from "./models";
import { cleanText, unsupportedChars } from "./text";
import type { CutMode } from "./types";

export interface RenderOptions {
  spec: PaperSpec;
  /** How the paper is finished after the last block, unless the document ends with its own cut. */
  cut: CutMode;
  /** Throw on layout mistakes instead of working around them. For tests. */
  strict?: boolean;
}

export interface Encoded {
  bytes: Uint8Array;
  /** Characters the printer can't print; they come out as "?". */
  unsupported: string[];
}

type Encoder = ReceiptPrinterEncoder;

export function createEncoder(spec: PaperSpec, strict = false): Encoder {
  return new ReceiptPrinterEncoder({ printerModel: spec.model, errors: strict ? "strict" : "relaxed" });
}

/** Dots of paper left below a QR code or barcode. */
const CODE_GAP = 10;

/** How many printed lines `text` takes at a given character size. */
export function linesAt(text: string, spec: PaperSpec, width: number, height: number): number {
  const lines = createEncoder(spec).size(width, height).text(text).newline().encode("commands");
  return lines.filter((line) => line.commands.some((command) => (command as { type?: string }).type === "text")).length;
}

/**
 * Leaves `dots` of blank paper as a line of its own: line spacing set to the gap (ESC 3 n), a line feed,
 * then the default spacing again (ESC 2). "Print and feed" (ESC J) would print the half-built line and
 * send the print head back to the margin, losing the alignment of the text after it.
 */
function feed(encoder: Encoder, dots: number, spec: PaperSpec) {
  if (spec.language !== "esc-pos") {
    // Star printers use other commands; whole lines are close enough there.
    for (let lines = Math.round(dots / 24); lines > 0; lines--) encoder.newline();
    return;
  }
  for (let left = Math.round(dots); left > 0; left -= 255) {
    encoder.raw([0x1b, 0x33, Math.min(255, left)]);
    encoder.newline();
    encoder.raw([0x1b, 0x32]);
  }
}

/** The blank margin between the last line and the cut. */
const BOTTOM_MARGIN = 15;

function cut(encoder: Encoder, mode: CutMode, spec: PaperSpec) {
  feed(encoder, BOTTOM_MARGIN, spec);
  if (mode === "none") encoder.newline(spec.cutFeed);
  else encoder.cut(mode);
}

function marker(entry: ListEntry, kind: "checkbox" | "bullet" | "number", index: number): string {
  if (kind === "checkbox") return entry.checked ? "[x]" : "[ ]";
  if (kind === "bullet") return "-";
  return `${index + 1}.`;
}

class Renderer {
  private align: Align = "left";

  constructor(
    private readonly encoder: Encoder,
    private readonly options: RenderOptions,
  ) {}

  private setAlign(align: Align = "left") {
    if (align === this.align) return;
    this.encoder.align(align);
    this.align = align;
  }

  block(block: Block) {
    const { encoder, options } = this;
    switch (block.type) {
      case "text": {
        this.setAlign(block.align);
        const lines = cleanText(block.text).split("\n");
        for (const line of lines) {
          if (block.font === "B") encoder.font("B");
          if (block.bold) encoder.bold(true);
          if (block.underline) encoder.underline(true);
          if (block.invert) encoder.invert(true);
          const sized = (block.width ?? 1) !== 1 || (block.height ?? 1) !== 1;
          if (sized) encoder.size(block.width ?? 1, block.height ?? 1);
          encoder.text(line);
          if (sized) encoder.size(1, 1);
          if (block.invert) encoder.invert(false);
          if (block.underline) encoder.underline(false);
          if (block.bold) encoder.bold(false);
          encoder.newline();
          if (block.font === "B") encoder.font("A");
        }
        return;
      }
      case "markdown":
        this.setAlign(block.align);
        encoder.markdown(block.markdown);
        return;
      case "bar": {
        this.setAlign("left");
        const width = options.spec.columns;
        const right = block.right ? `${block.right} ` : "";
        const left = ` ${block.left}`.slice(0, Math.max(0, width - right.length - 1));
        const bar = (left + " ".repeat(Math.max(1, width - left.length - right.length)) + right).slice(0, width);
        encoder.bold(true).invert(true).text(bar).invert(false).bold(false).newline();
        return;
      }
      case "list": {
        this.setAlign("left");
        const kind = block.marker ?? "checkbox";
        const markers = block.items.map((item, index) => marker(item, kind, index));
        const markerWidth = Math.max(...markers.map((m) => m.length), 1);
        const asideWidth = block.asideWidth ?? Math.max(0, ...block.items.map((item) => (item.aside ?? "").length));
        block.items.forEach((item, index) => {
          const columns: Parameters<Encoder["table"]>[0] = [
            { width: markerWidth, marginLeft: (item.depth ?? 0) * 2, marginRight: 1 },
            { width: "auto" },
          ];
          const cells = [markers[index], cleanText(item.text).trim()];
          if (asideWidth > 0) {
            columns.push({ width: asideWidth, marginLeft: 1, align: "right" });
            cells.push(item.aside ?? "");
          }
          encoder.table(columns, [cells]);
        });
        return;
      }
      case "table": {
        this.setAlign("left");
        const rows: Parameters<Encoder["table"]>[1] = block.rows.map((row) => [...row]);
        if (block.header) {
          rows.unshift(block.header.map((cell) => (e: Encoder) => e.bold(true).text(cell).bold(false)));
        }
        encoder.table(
          block.columns.map((column) => ({
            width: column.width ?? "auto",
            align: column.align ?? "left",
            marginRight: 1,
          })),
          rows,
        );
        return;
      }
      case "rule":
        this.setAlign("left");
        encoder.rule({ style: block.style ?? "single" });
        return;
      case "space":
        feed(encoder, block.dots, options.spec);
        return;
      case "image":
        this.image(block);
        return;
      case "qr":
        // Codes end their line with a line feed; without line spacing it doesn't leave a blank line.
        this.setAlign(block.align ?? "center");
        encoder.lineSpacing("none");
        encoder.qrcode(block.value, { model: 2, size: block.size ?? 6, errorlevel: block.errorLevel ?? "m" });
        encoder.lineSpacing("default");
        feed(encoder, CODE_GAP, options.spec);
        return;
      case "barcode":
        this.setAlign(block.align ?? "center");
        encoder.lineSpacing("none");
        encoder.barcode(block.value, block.symbology, {
          height: block.height ?? 60,
          text: block.text === false ? "none" : "below",
        });
        encoder.lineSpacing("default");
        feed(encoder, CODE_GAP, options.spec);
        return;
      case "raw":
        encoder.raw(block.bytes);
        return;
      case "cut":
        cut(encoder, block.mode ?? (options.cut === "none" ? "none" : options.cut), options.spec);
        return;
    }
  }

  private image(block: ImageBlock) {
    if (!block.raster) {
      // Should have been loaded by resolveImages; print what it was instead of failing the whole receipt.
      this.block({ type: "text", text: `[${block.alt || "image"}]`, align: block.align ?? "center" });
      return;
    }
    this.setAlign("left");
    const prepared = prepareImage({ ...block, raster: block.raster }, this.options.spec.widthDots);
    this.encoder.image(prepared as unknown as ImageData, {
      width: prepared.width,
      height: prepared.height,
      algorithm: block.dither ?? "atkinson",
      threshold: block.threshold ?? 128,
    });
  }
}

/** Renders `blocks` on one receipt, ending with the configured cut unless the last block is a cut. */
export function renderDocument(original: Block[], options: RenderOptions): Encoded {
  const unsupported = unsupportedChars(cleanText(original.flatMap(textsOf).join("\n")), options.spec.codepages);
  const replace = (text: string) =>
    unsupported.length ? [...cleanText(text)].map((char) => (unsupported.includes(char) ? "?" : char)).join("") : text;
  const blocks = unsupported.length ? original.map((block) => mapTexts(block, replace)) : original;

  const encoder = createEncoder(options.spec, options.strict).initialize().codepage("auto");
  const renderer = new Renderer(encoder, options);
  for (const block of blocks) renderer.block(block);
  if (blocks[blocks.length - 1]?.type !== "cut") cut(encoder, options.cut, options.spec);
  return { bytes: encoder.encode(), unsupported };
}

/** Feeds the last printed line past the cutter and cuts. */
export function encodeFeedAndCut(spec: PaperSpec, mode: CutMode): Uint8Array {
  const encoder = createEncoder(spec).initialize();
  if (mode === "none") encoder.newline(spec.cutFeed);
  else encoder.cut(mode);
  return encoder.encode();
}

export type ImageLoader = (src: string) => Promise<RasterImage>;

/**
 * Loads every image block that only has a `src`. Images that can't be loaded print their alt text,
 * and are listed in `missing`, so one bad image doesn't lose the rest of the receipt.
 */
export async function resolveImages(
  blocks: Block[],
  load?: ImageLoader,
): Promise<{ blocks: Block[]; missing: string[] }> {
  const missing: string[] = [];
  const resolved = await Promise.all(
    blocks.map(async (block): Promise<Block> => {
      if (block.type !== "image" || block.raster || !block.src) return block;
      try {
        if (!load) throw new Error("No image loader");
        return { ...block, raster: await load(block.src) };
      } catch {
        missing.push(block.src);
        return { ...block, alt: block.alt || `image not found: ${block.src.split("/").pop()}` };
      }
    }),
  );
  return { blocks: resolved, missing };
}
