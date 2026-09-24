/**
 * The content model: a receipt is a list of blocks, printed top to bottom. Any content the printer can
 * produce has a block, and render.ts turns a list of blocks into printer bytes. The receipt styles in
 * layout.ts are templates that build these blocks.
 */
import type { BarcodeSymbology } from "@point-of-sale/receipt-printer-encoder";
import type { RasterImage } from "./image";

export type Align = "left" | "center" | "right";

/** How an image is turned into black and white dots. */
export type Dither = "atkinson" | "floydsteinberg" | "bayer" | "threshold";

export interface TextStyle {
  bold?: boolean;
  underline?: boolean;
  /** White on black. */
  invert?: boolean;
  /** Character width and height multipliers, 1 to 8. */
  width?: number;
  height?: number;
  /** Font B is the printer's smaller font. */
  font?: "A" | "B";
  align?: Align;
}

export interface ListEntry {
  text: string;
  checked?: boolean;
  /** Nesting level, 0 for top-level entries. */
  depth?: number;
  /** Right-aligned extra text, like a due date. */
  aside?: string;
}

export interface TableColumn {
  /** Characters, or "auto" to take the space that's left. */
  width?: number | "auto";
  align?: Align;
}

export interface ImageBlock {
  type: "image";
  /** A file path, file:// or http(s) URL, or data: URI. Loaded into `raster` before printing. */
  src?: string;
  raster?: RasterImage;
  /** Paper width ("full", the default), half of it, the image's own size scaled down to fit, or dots. */
  width?: "full" | "half" | "original" | number;
  align?: Align;
  /** Default "atkinson", which suits photos; "threshold" suits line art and screenshots of text. */
  dither?: Dither;
  /** 0 to 255, for "threshold" and "bayer". */
  threshold?: number;
  /** -1 to 1. */
  brightness?: number;
  /** -1 to 1. */
  contrast?: number;
  /** Above 1 lightens mid-tones, which thermal paper tends to print too dark. */
  gamma?: number;
  invert?: boolean;
  /** Degrees clockwise, or "landscape" to turn wide images sideways so they print larger. */
  rotate?: 0 | 90 | 180 | 270 | "landscape";
  /** Scale down so the image is at most this many dots tall. */
  maxHeight?: number;
  /** Printed instead when the image can't be loaded. */
  alt?: string;
}

export type Block =
  | ({ type: "text"; text: string } & TextStyle)
  | { type: "markdown"; markdown: string; align?: Align }
  /** A white-on-black bar across the paper, text on the left and right. */
  | { type: "bar"; left: string; right?: string }
  | { type: "list"; items: ListEntry[]; marker?: "checkbox" | "bullet" | "number"; asideWidth?: number }
  | { type: "table"; columns: TableColumn[]; rows: string[][]; header?: string[] }
  | { type: "rule"; style?: "single" | "double" }
  /** Blank paper, in dots (the TM-T88V has 180 per inch). */
  | { type: "space"; dots: number }
  | ImageBlock
  | { type: "qr"; value: string; size?: number; errorLevel?: "l" | "m" | "q" | "h"; align?: Align }
  | { type: "barcode"; value: string; symbology: BarcodeSymbology; height?: number; text?: boolean; align?: Align }
  | { type: "raw"; bytes: number[] }
  | { type: "cut"; mode?: "partial" | "full" };

export type BlockType = Block["type"];

/** The texts in a block that the printer will print, for character checks. */
export function textsOf(block: Block): string[] {
  switch (block.type) {
    case "text":
      return [block.text];
    case "markdown":
      return [block.markdown];
    case "bar":
      return [block.left, block.right ?? ""];
    case "list":
      return block.items.flatMap((item) => [item.text, item.aside ?? ""]);
    case "table":
      return [...(block.header ?? []), ...block.rows.flat()];
    case "image":
      return block.raster ? [] : [block.alt ?? ""];
    default:
      return [];
  }
}

/** Applies `edit` to every printed text in a block. */
export function mapTexts(block: Block, edit: (text: string) => string): Block {
  switch (block.type) {
    case "text":
      return { ...block, text: edit(block.text) };
    case "markdown":
      return { ...block, markdown: edit(block.markdown) };
    case "bar":
      return { ...block, left: edit(block.left), right: block.right && edit(block.right) };
    case "list":
      return {
        ...block,
        items: block.items.map((item) => ({ ...item, text: edit(item.text), aside: item.aside && edit(item.aside) })),
      };
    case "table":
      return { ...block, header: block.header?.map(edit), rows: block.rows.map((row) => row.map(edit)) };
    case "image":
      return { ...block, alt: block.alt && edit(block.alt) };
    default:
      return block;
  }
}

/** Blocks without decoded images, for storing: images are kept by `src` only. */
export function withoutRasters(blocks: Block[]): Block[] {
  return blocks.map((block) => {
    if (block.type !== "image" || !block.raster) return block;
    const copy: ImageBlock = { ...block };
    delete copy.raster;
    return copy;
  });
}
