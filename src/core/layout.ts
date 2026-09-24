/**
 * The house style ("kitchen ticket"): each receipt style is a template that builds blocks for the
 * general renderer in render.ts.
 *
 * Rules: at most one double-size element per receipt, white-on-black only for the header bar,
 * font B for small details, ASCII checkboxes, no blank lines at either end.
 */
import { compareDue, dueColumn, groupOf, isOverdue, type DateOrder } from "./dates";
import type { Align, Block, ImageBlock, ListEntry } from "./document";
import type { PaperSpec } from "./models";
import { linesAt, renderDocument, type Encoded } from "./render";
import { checklistFromText, cleanText, memoSegments, oneLine, softenHeadings, splitTitle } from "./text";
import type { ChecklistItem, CutMode, Receipt } from "./types";

export { encodeFeedAndCut, linesAt } from "./render";

export interface LayoutOptions {
  spec: PaperSpec;
  now: Date;
  /** Optional name printed at the top of lists and memos. */
  label?: string;
  cut: CutMode;
  /** How numeric dates in the text are read. */
  dateOrder?: DateOrder;
  /** Throw on layout mistakes instead of working around them. For tests. */
  strict?: boolean;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export const shortDate = (date: Date) => `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
export const longDate = (date: Date) => `${shortDate(date)} ${date.getFullYear()} · ${clock(date)}`;

/** Ticket text is as big as it can be: double size up to two lines, then tall up to three, then normal. */
export function fitTicketText(text: string, spec: PaperSpec): { width: number; height: number } {
  if (linesAt(text, spec, 2, 2) <= 2) return { width: 2, height: 2 };
  if (linesAt(text, spec, 1, 2) <= 3) return { width: 1, height: 2 };
  return { width: 1, height: 1 };
}

const upper = (text: string) => text.toLocaleUpperCase("en-US");
const small = (text: string, align?: Align): Block => ({ type: "text", text, font: "B", align });

/** The white-on-black bar: a name on the left, the date and time on the right. */
function headerBar(name: string, options: LayoutOptions): Block[] {
  return [
    { type: "bar", left: upper(name), right: `${upper(shortDate(options.now))}  ${clock(options.now)}` },
    { type: "space", dots: 12 },
  ];
}

const entry = (item: ChecklistItem, aside?: string): ListEntry => ({
  text: cleanText(item.text).trim(),
  checked: item.checked,
  depth: item.depth,
  aside,
});

function ticket(receipt: Receipt, options: LayoutOptions): Block[] {
  const text = upper(oneLine(receipt.body));
  const size = fitTicketText(text, options.spec);
  return [
    ...headerBar(receipt.title?.trim() || "Ticket", options),
    { type: "text", text, bold: true, width: size.width, height: size.height },
  ];
}

/** A list title in double size, letter-spaced when that still fits on one line. */
function listTitle(title: string, spec: PaperSpec): Block {
  const text = upper(title);
  const spaced = text
    .split(" ")
    .map((word) => [...word].join(" "))
    .join("   ");
  if (spaced.length <= Math.floor(spec.columns / 2)) {
    return { type: "text", text: spaced, bold: true, width: 2, height: 2, align: "center" };
  }
  const size = linesAt(text, spec, 2, 2) <= 2 ? 2 : 1;
  return { type: "text", text, bold: true, width: size, height: 2, align: "center" };
}

function checklistItems(receipt: Receipt, options: LayoutOptions): { title?: string; items: ChecklistItem[] } {
  if (receipt.items) return { title: receipt.title, items: receipt.items };
  const parsed = checklistFromText(receipt.body, { now: options.now, order: options.dateOrder ?? "month-first" });
  return { title: receipt.title?.trim() || parsed.title, items: parsed.items };
}

/** A shop-receipt list, for lists without due dates (groceries, packing). */
function plainChecklist(title: string | undefined, items: ChecklistItem[], options: LayoutOptions): Block[] {
  const label = options.label?.trim();
  return [
    ...(label ? [small(upper(cleanText(label)), "center")] : []),
    ...(title ? [listTitle(cleanText(title), options.spec)] : []),
    small(longDate(options.now), "center"),
    { type: "rule", style: "double" },
    { type: "list", items: items.map((item) => entry(item)) },
    { type: "rule" },
    { type: "text", text: `${items.length} ${items.length === 1 ? "ITEM" : "ITEMS"}`, bold: true },
  ];
}

/** A to-do list grouped by day: Overdue, Today, Tomorrow, the next days, Later, No date. */
function dueChecklist(title: string | undefined, items: ChecklistItem[], options: LayoutOptions): Block[] {
  const { now } = options;
  const order = options.dateOrder ?? "month-first";
  const label = options.label?.trim();
  const blocks: Block[] = [
    ...(label ? [small(upper(cleanText(label)), "center")] : []),
    ...headerBar(cleanText(title?.trim() || "To-do"), options),
  ];

  const groups = new Map<string, { title: string; rank: number; items: ChecklistItem[] }>();
  for (const item of items) {
    const group = groupOf(item.due, now);
    const found = groups.get(group.id) ?? { title: group.title, rank: group.rank, items: [] };
    found.items.push(item);
    groups.set(group.id, found);
  }
  const asideWidth = Math.max(0, ...items.map((item) => dueColumn(item.due, now, order).length));

  [...groups.values()]
    .sort((a, b) => a.rank - b.rank)
    .forEach((group, index) => {
      if (index > 0) blocks.push({ type: "space", dots: 10 });
      blocks.push({ type: "text", text: upper(group.title), bold: true });
      const sorted = group.items
        .map((item, position) => ({ item, position }))
        .sort((a, b) => compareDue(a.item.due, b.item.due) || a.position - b.position)
        .map(({ item }) => entry(item, dueColumn(item.due, now, order)));
      blocks.push({ type: "list", items: sorted, asideWidth });
    });

  const open = items.filter((item) => !item.checked);
  const overdue = open.filter((item) => isOverdue(item.due, now)).length;
  const count = `${open.length} ${open.length === 1 ? "TASK" : "TASKS"}`;
  blocks.push({ type: "rule" }, { type: "text", text: overdue ? `${count} · ${overdue} OVERDUE` : count, bold: true });
  return blocks;
}

function checklist(receipt: Receipt, options: LayoutOptions): Block[] {
  const { title, items } = checklistItems(receipt, options);
  return items.some((item) => item.due) ? dueChecklist(title, items, options) : plainChecklist(title, items, options);
}

function memo(receipt: Receipt, options: LayoutOptions): Block[] {
  const document = receipt.title?.trim()
    ? { title: cleanText(receipt.title).trim(), body: cleanText(receipt.body).trim() }
    : splitTitle(cleanText(receipt.body));
  const label = options.label?.trim();
  const blocks: Block[] = [];
  if (document.title) {
    const size = linesAt(document.title, options.spec, 2, 2) <= 2 ? 2 : 1;
    blocks.push({ type: "text", text: document.title, bold: true, width: size, height: 2 });
  }
  blocks.push(small([longDate(options.now), label && cleanText(label)].filter(Boolean).join(" · ")), { type: "rule" });
  for (const segment of memoSegments(softenHeadings(document.body))) {
    if (segment.kind === "tasks") blocks.push({ type: "list", items: segment.items.map((item) => entry(item)) });
    else if (segment.kind === "image") blocks.push({ type: "image", src: segment.src, alt: segment.alt || undefined });
    else blocks.push({ type: "markdown", markdown: segment.text });
  }
  return blocks;
}

function plain(receipt: Receipt): Block[] {
  return [{ type: "text", text: cleanText(receipt.body).replace(/^\n+|\n+$/g, "") }];
}

export type ImageLook = "photo" | "smooth" | "pattern" | "lineart";
export type ImageTone = "darker" | "normal" | "lighter" | "lightest";

export interface PictureOptions {
  size: "full" | "half" | "original";
  look: ImageLook;
  tone: ImageTone;
  /** Turn wide pictures sideways so they print larger. */
  sideways: boolean;
  caption?: string;
}

/** Dithering and gamma for each kind of picture; thermal paper prints mid-tones dark, so photos are lifted. */
const LOOKS: Record<ImageLook, Pick<ImageBlock, "dither" | "gamma" | "threshold">> = {
  photo: { dither: "atkinson", gamma: 1.25 },
  smooth: { dither: "floydsteinberg", gamma: 1.25 },
  pattern: { dither: "bayer", gamma: 1.15 },
  lineart: { dither: "threshold", threshold: 150 },
};
const TONES: Record<ImageTone, number> = { darker: -0.1, normal: 0, lighter: 0.1, lightest: 0.2 };

/** Pictures one under another, with an optional caption: the Print Image layout. */
export function pictureBlocks(sources: string[], options: PictureOptions): Block[] {
  const blocks: Block[] = [];
  sources.forEach((src, index) => {
    if (index > 0) blocks.push({ type: "space", dots: 24 });
    blocks.push({
      type: "image",
      src,
      width: options.size,
      ...LOOKS[options.look],
      brightness: TONES[options.tone],
      rotate: options.sideways ? "landscape" : 0,
      alt: src.split("/").pop(),
    });
  });
  const caption = options.caption?.trim();
  if (caption) blocks.push({ type: "text", text: caption, align: "center" });
  return blocks;
}

/** The blocks a receipt prints as, in the house style. */
export function receiptBlocks(receipt: Receipt, options: LayoutOptions): Block[] {
  switch (receipt.style) {
    case "ticket":
      return ticket(receipt, options);
    case "checklist":
      return checklist(receipt, options);
    case "memo":
      return memo(receipt, options);
    case "plain":
      return plain(receipt);
    case "document":
      return receipt.blocks ?? [];
  }
}

/** Lays out and encodes a receipt that has no images to load. */
export function encodeReceipt(receipt: Receipt, options: LayoutOptions): Encoded {
  return renderDocument(receiptBlocks(receipt, options), options);
}
