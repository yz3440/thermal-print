import assert from "node:assert/strict";
import { test } from "node:test";
import { findList, parseQuickInput } from "../../src/core/grammar";

const lists = [
  { id: "g", name: "Groceries" },
  { id: "w", name: "Work" },
  { id: "ws", name: "Workshop" },
  { id: "wk", name: "Weekend Trip" },
];

test("@list at the start or end adds to that list", () => {
  assert.deepEqual(parseQuickInput("@groceries oat milk", lists), { text: "oat milk", list: lists[0] });
  assert.deepEqual(parseQuickInput("oat milk @groc", lists), { text: "oat milk", list: lists[0] });
  assert.deepEqual(parseQuickInput("pack socks @weekend", lists), { text: "pack socks", list: lists[3] });
});

test("an exact name wins over a longer list with the same prefix", () => {
  assert.equal(findList("@work", lists)?.id, "w");
  assert.equal(findList("@works", lists)?.id, "ws");
  assert.equal(findList("@wor", lists), undefined, "ambiguous prefix");
});

test("anything else is plain text", () => {
  assert.deepEqual(parseQuickInput("email bob@example.com", lists), { text: "email bob@example.com" });
  assert.deepEqual(parseQuickInput("Ship it!", lists), { text: "Ship it!" });
  assert.deepEqual(parseQuickInput("meet @alice at noon", lists), { text: "meet @alice at noon" });
  assert.deepEqual(parseQuickInput("@groceries", lists), { text: "@groceries" }, "nothing to add");
  assert.deepEqual(parseQuickInput("  buy   milk  ", []), { text: "buy milk" });
});
