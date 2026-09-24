import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareDue,
  daysUntil,
  describeDue,
  dueColumn,
  groupOf,
  isOverdue,
  parseTask,
  type Due,
} from "../../src/core/dates";

/** Wednesday 23 September 2026, 18:52. */
const NOW = new Date(2026, 8, 23, 18, 52);

const cases: [string, string, Due | undefined][] = [
  ["call dentist tomorrow 3pm", "call dentist", { date: "2026-09-24", time: "15:00" }],
  ["submit report by friday", "submit report", { date: "2026-09-25" }],
  ["pay rent sep 30", "pay rent", { date: "2026-09-30" }],
  ["email Prof. Lee next monday at 9", "email Prof. Lee", { date: "2026-09-28", time: "09:00" }],
  ["gym at 7am", "gym", { date: "2026-09-24", time: "07:00" }],
  ["renew passport in 2 weeks", "renew passport", { date: "2026-10-07" }],
  ["team sync 14:30", "team sync", { date: "2026-09-24", time: "14:30" }],
  ["tax return due 2026-10-31", "tax return", { date: "2026-10-31" }],
  ["book train on 10 Oct", "book train", { date: "2026-10-10" }],
  ["buy oat milk", "buy oat milk", undefined],
  ["read chapter 5", "read chapter 5", undefined],
];

for (const [input, text, due] of cases) {
  test(`parseTask: ${input}`, () => {
    assert.deepEqual(parseTask(input, NOW), due ? { text, due } : { text });
  });
}

test("a bare hour from 1 to 7 means the afternoon", () => {
  assert.deepEqual(parseTask("call mom at 5", NOW), { text: "call mom", due: { date: "2026-09-24", time: "17:00" } });
  const morning = new Date(2026, 8, 23, 9, 0);
  assert.deepEqual(parseTask("call mom at 5", morning), {
    text: "call mom",
    due: { date: "2026-09-23", time: "17:00" },
  });
  assert.deepEqual(parseTask("call mom friday at 5", NOW), {
    text: "call mom",
    due: { date: "2026-09-25", time: "17:00" },
  });
  assert.deepEqual(parseTask("standup at 9", NOW), { text: "standup", due: { date: "2026-09-24", time: "09:00" } });
});

test("a date on its own is a task, not a due date", () => {
  assert.deepEqual(parseTask("tomorrow", NOW), { text: "tomorrow" });
});

test("numeric dates follow the chosen order", () => {
  assert.deepEqual(parseTask("dentist 10/9", NOW, "month-first").due, { date: "2026-10-09" });
  assert.deepEqual(parseTask("dentist 10/9", NOW, "day-first").due, { date: "2027-09-10" });
  assert.deepEqual(parseTask("dentist 30/9", NOW, "day-first").due, { date: "2026-09-30" });
});

test("days and groups", () => {
  assert.equal(daysUntil({ date: "2026-09-23" }, NOW), 0);
  assert.equal(daysUntil({ date: "2026-09-21" }, NOW), -2);
  assert.equal(groupOf(undefined, NOW).key, "none");
  assert.equal(groupOf({ date: "2026-09-22" }, NOW).key, "overdue");
  assert.equal(groupOf({ date: "2026-09-23" }, NOW).title, "Today · Wed 23");
  assert.equal(groupOf({ date: "2026-09-24" }, NOW).title, "Tomorrow · Thu 24");
  assert.equal(groupOf({ date: "2026-09-29" }, NOW).title, "Tue 29");
  assert.equal(groupOf({ date: "2026-09-30" }, NOW).key, "later");
});

test("due column and descriptions", () => {
  assert.equal(dueColumn({ date: "2026-09-24", time: "15:00" }, NOW), "15:00");
  assert.equal(dueColumn({ date: "2026-09-24" }, NOW), "");
  assert.equal(dueColumn({ date: "2026-09-21" }, NOW), "Mon 21");
  assert.equal(dueColumn({ date: "2026-09-30" }, NOW), "Sep 30");
  assert.equal(dueColumn({ date: "2026-09-30" }, NOW, "day-first"), "30 Sep");
  assert.equal(dueColumn({ date: "2027-01-05", time: "09:00" }, NOW), "Jan 5 2027 09:00");
  assert.equal(describeDue({ date: "2026-09-23", time: "20:30" }, NOW), "Today 20:30");
  assert.equal(describeDue({ date: "2026-09-24" }, NOW), "Tomorrow");
  assert.equal(describeDue({ date: "2026-09-25", time: "09:00" }, NOW), "Fri 09:00");
  assert.equal(describeDue({ date: "2026-09-22" }, NOW), "Yesterday");
  assert.equal(describeDue({ date: "2026-10-07" }, NOW), "Oct 7");
});

test("overdue and ordering", () => {
  assert.ok(isOverdue({ date: "2026-09-22" }, NOW));
  assert.ok(isOverdue({ date: "2026-09-23", time: "09:00" }, NOW));
  assert.ok(!isOverdue({ date: "2026-09-23" }, NOW), "an all-day task is due until the day ends");
  assert.ok(!isOverdue(undefined, NOW));
  const sorted = [
    { date: "2026-09-24", time: "15:00" },
    undefined,
    { date: "2026-09-24" },
    { date: "2026-09-23", time: "20:00" },
  ].sort(compareDue);
  assert.deepEqual(sorted, [
    { date: "2026-09-23", time: "20:00" },
    { date: "2026-09-24" },
    { date: "2026-09-24", time: "15:00" },
    undefined,
  ]);
});
