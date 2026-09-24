import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { encodeReceipt, fitTicketText } from "../../src/core/layout";
import { specFor } from "../../src/core/models";
import { renderPreview } from "../../src/core/preview";
import { BASE, FIXTURES } from "../fixtures";

const goldenDir = path.resolve(import.meta.dirname, "../golden");
const previewDir = path.resolve(import.meta.dirname, "../../.previews");
const update = process.env.UPDATE_GOLDEN === "1";

// Byte-for-byte snapshots. After a deliberate layout change: UPDATE_GOLDEN=1 npm test,
// then look at every changed image in .previews/ before committing the new .bin files.
for (const fixture of FIXTURES) {
  test(`golden: ${fixture.name}`, () => {
    const options = { ...BASE, ...fixture.options };
    const { bytes } = encodeReceipt(fixture.receipt, options);
    const file = path.join(goldenDir, `${fixture.name}.bin`);
    if (update || !existsSync(file)) {
      mkdirSync(goldenDir, { recursive: true });
      mkdirSync(previewDir, { recursive: true });
      writeFileSync(file, bytes);
      writeFileSync(path.join(previewDir, `${fixture.name}.png`), renderPreview(bytes, options.spec).png);
      return;
    }
    assert.deepEqual(Buffer.from(bytes), readFileSync(file), `${fixture.name} changed; see .previews/ after updating`);
  });
}

test("ticket text is as large as fits", () => {
  const spec = specFor("epson-tm-t88v");
  assert.deepEqual(fitTicketText("CALL THE DENTIST", spec), { width: 2, height: 2 });
  assert.deepEqual(fitTicketText("X".repeat(42), spec), { width: 2, height: 2 });
  assert.deepEqual(fitTicketText("WORD ".repeat(20).trim(), spec), { width: 1, height: 2 });
  assert.deepEqual(fitTicketText("WORD ".repeat(40).trim(), spec), { width: 1, height: 1 });
});

test("every unsupported character prints as one question mark", () => {
  const { bytes, unsupported } = encodeReceipt({ style: "plain", body: "a你🎉b" }, BASE);
  assert.deepEqual(unsupported, ["你", "🎉"]);
  assert.ok(Buffer.from(bytes).includes(Buffer.from("a??b")));
});

test("to-do lists group tasks by day under a header bar", () => {
  const fixture = FIXTURES.find((f) => f.name === "todo-grouped")!;
  const text = Buffer.from(encodeReceipt(fixture.receipt, { ...BASE, ...fixture.options }).bytes).toString("latin1");
  assert.match(text, / TO-DO +WED 23 SEP {2}18:52 /);
  const headings = ["OVERDUE", "TODAY", "TOMORROW", "FRI 25", "LATER", "NO DATE"].map((h) => text.indexOf(h));
  assert.ok(headings.every((at, i) => at > 0 && (i === 0 || at > headings[i - 1])), `headings in order: ${headings}`);
  assert.ok(text.indexOf("Go to the gym") < text.indexOf("Call the dentist"), "07:00 before 15:00");
  assert.match(text, /10 TASKS/);
  assert.match(text, /1 OVERDUE/);
});

test("lists without dates print as a plain checklist", () => {
  const text = Buffer.from(
    encodeReceipt({ style: "checklist", title: "Groceries", body: "milk\neggs" }, BASE).bytes,
  ).toString("latin1");
  assert.match(text, /G R O C E R I E S/);
  assert.match(text, /2 ITEMS/);
  assert.doesNotMatch(text, /NO DATE/);
});

test("cut modes", () => {
  const bytes = (cut: typeof BASE.cut) => Buffer.from(encodeReceipt({ style: "plain", body: "x" }, { ...BASE, cut }).bytes);
  const GS_V = Buffer.from([0x1d, 0x56]);
  assert.ok(bytes("partial").includes(GS_V));
  assert.ok(bytes("full").includes(GS_V));
  assert.ok(!bytes("none").includes(GS_V));
});
