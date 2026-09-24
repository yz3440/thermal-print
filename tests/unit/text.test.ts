import assert from "node:assert/strict";
import { test } from "node:test";
import { specFor } from "../../src/core/models";
import {
  checklistFromText,
  cleanText,
  detectStyle,
  memoSegments,
  oneLine,
  parseListLine,
  softenHeadings,
  splitTitle,
  summarize,
  unsupportedChars,
} from "../../src/core/text";

const codepages = specFor("epson-tm-t88v").codepages;

test("cleanText normalizes line breaks, invisible characters and symbols", () => {
  const nbsp = String.fromCharCode(0xa0);
  const zeroWidth = String.fromCharCode(0x200b);
  const variation = String.fromCharCode(0xfe0f);
  assert.equal(cleanText(`a${nbsp}b\r\nc${zeroWidth}d  \r`), "a b\ncd\n");
  assert.equal(cleanText(`✅${variation} done → next ☐`), "[x] done -> next [ ]");
  assert.equal(cleanText("tab\there"), "tab  here");
});

test("oneLine collapses whitespace", () => {
  assert.equal(oneLine("  buy\n oat   milk \n"), "buy oat milk");
});

test("unsupportedChars finds what no code page of the printer has", () => {
  assert.deepEqual(unsupportedChars("Café Größe Привет Ελληνικά — “x” 25 € ·", codepages), []);
  assert.deepEqual(unsupportedChars("你好 🎉 ok", codepages), ["你", "好", "🎉"]);
});

test("parseListLine understands markers, checkboxes and nesting", () => {
  assert.deepEqual(parseListLine("- milk"), { text: "milk", checked: false, depth: 0 });
  assert.deepEqual(parseListLine("  - [x] eggs"), { text: "eggs", checked: true, depth: 1 });
  assert.deepEqual(parseListLine("[ ] bread"), { text: "bread", checked: false, depth: 0 });
  assert.deepEqual(parseListLine("3. coffee"), { text: "coffee", checked: false, depth: 0 });
  assert.equal(parseListLine("just text"), undefined);
});

test("splitTitle takes a leading heading", () => {
  assert.deepEqual(splitTitle("# Groceries\n- milk"), { title: "Groceries", body: "- milk" });
  assert.deepEqual(splitTitle("no title\nhere"), { body: "no title\nhere" });
});

test("checklistFromText turns every line into an item", () => {
  const { title, items } = checklistFromText("# Trip\n- [x] passport\ncharger\n\n  - cable");
  assert.equal(title, "Trip");
  assert.deepEqual(
    items.map((item) => [item.text, item.checked, item.depth]),
    [
      ["passport", true, 0],
      ["charger", false, 0],
      ["cable", false, 1],
    ],
  );
});

test("detectStyle picks checklist or memo", () => {
  assert.equal(detectStyle("call the dentist"), "checklist");
  assert.equal(detectStyle("- milk\n- eggs"), "checklist");
  assert.equal(detectStyle("# Groceries\n- [ ] milk\n- [ ] eggs"), "checklist");
  assert.equal(detectStyle("# Notes\nSome thoughts.\n- a point"), "memo");
  assert.equal(detectStyle("x".repeat(141)), "memo");
});

test("checklistFromText reads due dates when asked", () => {
  const now = new Date(2026, 8, 23, 18, 52);
  const { items } = checklistFromText("- [ ] call dentist tomorrow 3pm\n- buy milk", { now, order: "month-first" });
  assert.deepEqual(items, [
    { text: "call dentist", checked: false, depth: 0, due: { date: "2026-09-24", time: "15:00" } },
    { text: "buy milk", checked: false, depth: 0 },
  ]);
  assert.equal(checklistFromText("- call dentist tomorrow").items[0].due, undefined, "no dates unless asked");
});

test("memoSegments separates task lines from ordinary markdown", () => {
  const segments = memoSegments("intro\n- [ ] one\n- [x] two\n\n**outro**");
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["markdown", "tasks", "markdown"],
  );
  assert.equal(segments[1].kind === "tasks" && segments[1].items.length, 2);
});

test("memoSegments picks out lines that are only an image", () => {
  const segments = memoSegments('intro\n![A cat](~/Pictures/cat.jpg)\n  ![](<file:///tmp/a b.png> "title")\ninline ![x](y.png) stays text');
  assert.deepEqual(segments, [
    { kind: "markdown", text: "intro" },
    { kind: "image", alt: "A cat", src: "~/Pictures/cat.jpg" },
    { kind: "markdown", text: '  ![](<file:///tmp/a b.png> "title")\ninline ![x](y.png) stays text' },
  ]);
});

test("softenHeadings avoids double-size headings in memo bodies", () => {
  assert.equal(softenHeadings("# Big\n## Medium\n#hashtag"), "## Big\n## Medium\n#hashtag");
});

test("summarize finds a readable name", () => {
  assert.equal(summarize(undefined, "# Groceries\n- milk"), "Groceries");
  assert.equal(summarize(undefined, "- [ ] milk\n- eggs"), "milk");
  assert.equal(summarize("Title", "body"), "Title");
  assert.equal(summarize(undefined, "a".repeat(80), 10), "aaaaaaaaa…");
});
