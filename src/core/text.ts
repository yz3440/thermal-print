/** Cleaning up text before it goes to the printer, and reading lists out of it. */
import CodepageEncoder from "@point-of-sale/codepage-encoder";
import { parseTask, type DateOrder } from "./dates";
import type { ChecklistItem } from "./types";

/** Symbols that are common in notes but missing from every receipt printer code page. */
const SUBSTITUTIONS: [RegExp, string][] = [
  [/[☐□◻⬜]/gu, "[ ]"],
  [/[☑☒✅✔✓]/gu, "[x]"],
  [/[→⇒➜➔➝⟶]/gu, "->"],
  [/[←⇐⟵]/gu, "<-"],
  [/[↔⇔]/gu, "<->"],
  [/≠/gu, "!="],
  [/[‐‑‒]/gu, "-"],
];

/** Normalizes line breaks and invisible characters, and swaps symbols the printer doesn't have for ASCII. */
export function cleanText(input: string): string {
  let text = input
    .normalize("NFC")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/\u200b|\u200c|\u200d|\u2060|\ufeff|\ufe0e|\ufe0f/g, "")
    .replace(/\t/g, "  ");
  for (const [pattern, replacement] of SUBSTITUTIONS) text = text.replace(pattern, replacement);
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/** Collapses a text to one line, for tickets. */
export function oneLine(input: string): string {
  return cleanText(input).replace(/\s+/g, " ").trim();
}

const supportedByCodepages = new Map<string, Set<number>>();

function supportedCodepoints(codepages: readonly string[]): Set<number> {
  const key = codepages.join(",");
  let supported = supportedByCodepages.get(key);
  if (!supported) {
    supported = new Set();
    for (const codepage of codepages) {
      if (!CodepageEncoder.supports(codepage)) continue;
      const points = CodepageEncoder.getCodepoints(
        codepage as Parameters<typeof CodepageEncoder.getCodepoints>[0],
        true,
      );
      for (const point of points) supported.add(point);
    }
    supportedByCodepages.set(key, supported);
  }
  return supported;
}

/** Characters the printer can't print with any of its code pages. They come out as "?". */
export function unsupportedChars(text: string, codepages: readonly string[]): string[] {
  const supported = supportedCodepoints(codepages);
  const found = new Set<string>();
  for (const char of text) {
    const point = char.codePointAt(0)!;
    if (point >= 0x80 && !supported.has(point)) found.add(char);
  }
  return [...found];
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$/;
const TASK = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\][ \t]+(.*)$/;
const BARE_TASK = /^(\s*)\[([ xX])\][ \t]+(.*)$/;
const ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

const depthOf = (indent: string) => Math.min(3, Math.floor(indent.length / 2));

/** Reads one line of a markdown list or checklist; undefined when the line isn't a list item. */
export function parseListLine(line: string): ChecklistItem | undefined {
  const task = line.match(TASK) ?? line.match(BARE_TASK);
  if (task) return { depth: depthOf(task[1]), checked: task[2] !== " ", text: task[3].trim() };
  const item = line.match(ITEM);
  if (item) return { depth: depthOf(item[1]), checked: false, text: item[2].trim() };
  return undefined;
}

const isTaskLine = (line: string) => TASK.test(line) || BARE_TASK.test(line);

/** Takes a leading "# Title" line off a document. */
export function splitTitle(text: string): { title?: string; body: string } {
  const lines = text.replace(/^\s*\n/, "").split("\n");
  const heading = lines[0]?.match(HEADING);
  if (!heading) return { body: text.trim() };
  return { title: heading[1], body: lines.slice(1).join("\n").trim() };
}

/**
 * Every non-empty line becomes an item; list markers and checkboxes are understood, a leading heading is
 * the title. With `dates`, due dates are read out of each line ("call dentist tomorrow 3pm").
 */
export function checklistFromText(
  text: string,
  dates?: { now: Date; order: DateOrder },
): { title?: string; items: ChecklistItem[] } {
  const { title, body } = splitTitle(cleanText(text));
  const items = body
    .split("\n")
    .filter((line) => line.trim())
    .map((line): ChecklistItem => {
      const item = parseListLine(line) ?? { text: line.trim().replace(HEADING, "$1"), checked: false, depth: 0 };
      if (!dates) return item;
      const task = parseTask(item.text, dates.now, dates.order);
      return task.due ? { ...item, text: task.text, due: task.due } : item;
    });
  return { title, items };
}

/** Picks a style for text that arrives without one: a list, or a single short line, is a checklist. */
export function detectStyle(text: string): "checklist" | "memo" {
  const { title, body } = splitTitle(cleanText(text));
  const lines = body.split("\n").filter((line) => line.trim());
  if (!title && lines.length === 1 && lines[0].length <= 140) return "checklist";
  if (lines.length > 0 && lines.every((line) => parseListLine(line))) return "checklist";
  return "memo";
}

export type Segment =
  | { kind: "markdown"; text: string }
  | { kind: "tasks"; items: ChecklistItem[] }
  | { kind: "image"; src: string; alt: string };

/** A line that is only an image: ![alt](path "optional title"). */
const IMAGE_LINE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/;

/**
 * Splits markdown into ordinary runs, runs of task-list lines and image lines: the encoder's markdown
 * prints the first, but only the text of the other two.
 */
export function memoSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  for (const line of markdown.split("\n")) {
    const last = segments[segments.length - 1];
    const image = line.match(IMAGE_LINE);
    if (image) {
      segments.push({ kind: "image", alt: image[1], src: image[2] });
      continue;
    }
    const task = isTaskLine(line) ? parseListLine(line) : undefined;
    if (task) {
      if (last?.kind === "tasks") last.items.push(task);
      else segments.push({ kind: "tasks", items: [task] });
    } else if (last?.kind === "markdown") {
      last.text += `\n${line}`;
    } else {
      segments.push({ kind: "markdown", text: line });
    }
  }
  return segments;
}

/** Turns "# Heading" into "## Heading" so a memo body never prints the double-size heading. */
export function softenHeadings(markdown: string): string {
  return markdown.replace(/^( {0,3})#(?=[ \t])/gm, "$1##");
}

/** A short one-line name for a receipt, for lists and toasts. */
export function summarize(title: string | undefined, body: string, max = 60): string {
  const first =
    title?.trim() ||
    body
      .split("\n")
      .map((line) =>
        line
          .replace(HEADING, "$1")
          .replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/, "")
          .trim(),
      )
      .find(Boolean) ||
    "Untitled";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
