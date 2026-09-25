import assert from "node:assert/strict";
import { test } from "node:test";
import { HISTORY_LIMIT, itemsMarkdown, receiptOf, SCHEMA_VERSION, Store } from "../../src/core/store";
import { checklistFromText } from "../../src/core/text";
import { MemoryKV } from "../harness/memory-kv";

function setup(start = new Date(2026, 8, 23, 9, 0)) {
  let now = start;
  const kv = new MemoryKV();
  const store = new Store(kv, () => now);
  return { kv, store, tick: (ms = 1000) => (now = new Date(now.getTime() + ms)) };
}

test("migrate writes the schema version and drops the old ticket counter", async () => {
  const { kv, store } = setup();
  kv.map.set("seq:ticket", JSON.stringify({ day: "2026-09-23", last: 4 }));
  await store.migrate();
  assert.equal(kv.map.get("schema"), String(SCHEMA_VERSION));
  assert.equal(kv.map.has("seq:ticket"), false);
});

test("migrate turns version 2 lists into drafts of their open tasks, and drops empty ones", async () => {
  const { kv, store } = setup();
  kv.map.set("schema", "2");
  const stamp = "2026-09-20T10:00:00.000Z";
  kv.map.set(
    "rec:list1",
    JSON.stringify({
      id: "list1",
      kind: "list",
      style: "checklist",
      title: "To-Do",
      body: "",
      items: [
        { id: "a", text: "call dentist", due: { date: "2026-09-24", time: "15:00" } },
        { id: "b", text: "buy milk" },
        { id: "c", text: "old task", done: true, doneAt: stamp },
      ],
      source: "library",
      createdAt: stamp,
      updatedAt: stamp,
    }),
  );
  kv.map.set(
    "rec:list2",
    JSON.stringify({
      id: "list2",
      kind: "list",
      style: "checklist",
      title: "Empty",
      body: "",
      items: [],
      source: "library",
      createdAt: stamp,
      updatedAt: stamp,
    }),
  );
  kv.map.set("list:default", "list1");
  await store.migrate();

  const records = await store.all();
  assert.deepEqual(
    records.map((record) => [record.id, record.kind]),
    [["list1", "draft"]],
  );
  const draft = records[0];
  assert.equal(draft.body, "- [ ] call dentist 2026-09-24 15:00\n- [ ] buy milk");
  assert.equal(draft.items?.length, 2);
  assert.deepEqual(receiptOf(draft).items?.[0].due, { date: "2026-09-24", time: "15:00" });
  assert.equal(kv.map.has("list:default"), false);
  assert.equal(kv.map.get("schema"), String(SCHEMA_VERSION));
});

test("itemsMarkdown writes dates that checklistFromText reads back", () => {
  const items = [
    { text: "call dentist", due: { date: "2026-09-24", time: "15:00" } },
    { text: "pay rent", due: { date: "2026-10-01" } },
    { text: "buy milk", done: true },
  ];
  const markdown = itemsMarkdown(items);
  assert.equal(markdown, "- [ ] call dentist 2026-09-24 15:00\n- [ ] pay rent 2026-10-01\n- [x] buy milk");
  const parsed = checklistFromText(markdown, { now: new Date(2026, 8, 23, 9, 0), order: "month-first" });
  assert.deepEqual(
    parsed.items.map((item) => [item.text, item.checked, item.due]),
    [
      ["call dentist", false, { date: "2026-09-24", time: "15:00" }],
      ["pay rent", false, { date: "2026-10-01" }],
      ["buy milk", true, undefined],
    ],
  );
});

test("records come back newest first", async () => {
  const { store, tick } = setup();
  const first = await store.create({ kind: "draft", style: "memo", body: "a", source: "compose" });
  tick();
  const second = await store.create({ kind: "draft", style: "memo", body: "b", source: "compose" });
  assert.deepEqual(
    (await store.all()).map((record) => record.id),
    [second.id, first.id],
  );
});

test("a pending job becomes its history entry once printed", async () => {
  const { store, tick } = setup();
  const receipt = { style: "memo" as const, body: "call" };
  const pending = await store.recordPending(receipt, { source: "compose", error: "offline", maybePrinted: false });
  tick();
  const again = await store.recordPending(receipt, {
    source: "compose",
    error: "still offline",
    maybePrinted: true,
    fromId: pending.id,
  });
  assert.equal(again.id, pending.id, "a failed retry updates the same pending job");
  assert.equal(again.error, "still offline");
  const printed = await store.recordPrinted(receipt, { source: "compose", fromId: pending.id });
  assert.equal(printed.id, pending.id);
  assert.equal(printed.kind, "history");
  assert.equal(printed.error, undefined);
  assert.equal((await store.all()).length, 1);
});

test("printing a draft keeps the draft and logs a snapshot with its dates", async () => {
  const { store } = setup();
  const items = [{ id: "s", text: "socks", due: { date: "2026-09-25" } }];
  const draft = await store.create({
    kind: "draft",
    style: "checklist",
    title: "Trip",
    body: itemsMarkdown(items),
    items,
    source: "compose",
  });
  await store.recordPrinted(receiptOf(draft), { source: "library", fromId: draft.id });
  const records = await store.all();
  assert.equal(records.length, 2);
  assert.ok(records.find((record) => record.kind === "draft")?.printedAt);
  const history = records.find((record) => record.kind === "history")!;
  assert.equal(history.items?.[0].text, "socks");
  assert.deepEqual(receiptOf(history).items?.[0].due, { date: "2026-09-25" });
});

test(`history keeps the ${HISTORY_LIMIT} newest unpinned entries`, async () => {
  const { store, tick } = setup();
  const pinned = await store.recordPrinted({ style: "memo", body: "keep me" }, { source: "compose" });
  await store.save({ ...pinned, pinned: true });
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    tick();
    await store.recordPrinted({ style: "memo", body: `job ${i}` }, { source: "compose" });
  }
  const history = (await store.all()).filter((record) => record.kind === "history");
  assert.equal(history.length, HISTORY_LIMIT + 1);
  assert.ok(history.some((record) => record.body === "keep me"));
  assert.ok(!history.some((record) => record.body === "job 0"));
  assert.ok(history.some((record) => record.body === `job ${HISTORY_LIMIT + 4}`));
});

test("printer cache per address", async () => {
  const { store } = setup();
  await store.setPrinterCache("192.168.1.3", { model: "epson-tm-t88v", detected: true, identity: "EPSON TM-T88V" });
  assert.equal((await store.printerCache("192.168.1.3"))?.model, "epson-tm-t88v");
  await store.clearPrinterCache("192.168.1.3");
  assert.equal(await store.printerCache("192.168.1.3"), undefined);
});
