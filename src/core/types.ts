import type { Due } from "./dates";
import type { Block } from "./document";

/** "document" prints `blocks` as they are; the other styles are templates in layout.ts. */
export type Style = "ticket" | "checklist" | "memo" | "plain" | "document";

export interface ChecklistItem {
  text: string;
  checked: boolean;
  /** Nesting level, 0 for top-level items. */
  depth: number;
  due?: Due;
}

/** Something to print. */
export interface Receipt {
  style: Style;
  title?: string;
  /** The markdown of a memo, the lines of a checklist, plain text, or a ticket's text. */
  body: string;
  /** Checklist items with their due dates, when they come from a stored list rather than text. */
  items?: ChecklistItem[];
  /** The content of a "document" receipt: images, codes, text, anything the renderer supports. */
  blocks?: Block[];
}

export type CutMode = "partial" | "full" | "none";
