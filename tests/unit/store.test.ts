import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIST_NAME, HISTORY_LIMIT, receiptOf, SCHEMA_VERSION, Store } from "../../src/core/store";
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

test("the default list is created once and remembered", async () => {
  const { store } = setup();
  const first = await store.defaultList();
  const second = await store.defaultList();
  assert.equal(first.title, DEFAULT_LIST_NAME);
  assert.equal(first.id, second.id);
  assert.ok(await store.isDefaultList(first.id));
  await store.remove(first.id);
  const replacement = await store.defaultList();
  assert.notEqual(replacement.id, first.id, "deleting the default list makes a new one");
});

test("tasks carry due dates, and printing a list prints its open tasks", async () => {
  const { store } = setup();
  const list = await store.defaultList();
  await store.addToList(list.id, " call dentist ", { date: "2026-09-24", time: "15:00" });
  await store.addToList(list.id, "buy milk");
  const withTasks = await store.addToList(list.id, "old task");
  const old = withTasks.items!.find((item) => item.text === "old task")!;
  await store.setDone(list.id, old.id, true);

  const saved = (await store.get(list.id))!;
  assert.equal(saved.items?.length, 3);
  assert.ok(saved.items?.find((item) => item.id === old.id)?.doneAt);
  const receipt = receiptOf(saved);
  assert.equal(receipt.style, "checklist");
  assert.deepEqual(receipt.items, [
    { text: "call dentist", checked: false, depth: 0, due: { date: "2026-09-24", time: "15:00" } },
    { text: "buy milk", checked: false, depth: 0, due: undefined },
  ]);
  assert.equal(receipt.body, "- [ ] call dentist\n- [ ] buy milk");

  await store.clearDone(list.id);
  assert.equal((await store.get(list.id))!.items?.length, 2);
  const first = (await store.get(list.id))!.items![0];
  await store.updateItem(list.id, first.id, { due: undefined, text: "call the dentist" });
  assert.deepEqual((await store.get(list.id))!.items![0].text, "call the dentist");
  await store.removeItem(list.id, first.id);
  await store.clearList(list.id);
  assert.deepEqual((await store.get(list.id))!.items, []);
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

test("printing a list keeps the list and logs a snapshot of its tasks", async () => {
  const { store } = setup();
  const list = await store.createList("Trip", [{ text: "socks", due: { date: "2026-09-25" } }]);
  await store.recordPrinted(receiptOf(list), { source: "list", fromId: list.id });
  const records = await store.all();
  assert.equal(records.length, 2);
  assert.ok(records.find((record) => record.kind === "list")?.printedAt);
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
