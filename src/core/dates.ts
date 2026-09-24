/** Due dates: reading them out of task text, and naming and grouping them for lists and receipts. */
import * as chrono from "chrono-node";

/** A due date in local time, "2026-09-24", plus "15:00" when a time was given. */
export interface Due {
  date: string;
  time?: string;
}

/** How to read numeric dates like 10/9. */
export type DateOrder = "month-first" | "day-first";

export interface ParsedTask {
  text: string;
  due?: Due;
}

const pad = (value: number) => String(value).padStart(2, "0");
const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The due moment as a Date: midnight for all-day tasks. */
export function dueDate(due: Due): Date {
  const [year, month, day] = due.date.split("-").map(Number);
  const [hours, minutes] = (due.time ?? "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

export function dueFrom(date: Date, allDay: boolean): Due {
  return allDay ? { date: localDate(date) } : { date: localDate(date), time: localTime(date) };
}

/** Words that only tied the date to the task: "submit report by friday" leaves "submit report". */
const DANGLING_END = /(?:^|\s+)(?:by|on|at|due|before|until|till|for|from|this|next|,|-|–|—|:)$/i;
const DANGLING_START = /^(?:on|at|by|due)\s+/i;

/**
 * Splits "call dentist tomorrow 3pm" into the task and its due date. The last date phrase wins.
 * A bare hour from 1 to 7 without am/pm means the afternoon: "call mom at 5" is 17:00.
 */
export function parseTask(input: string, now: Date, order: DateOrder = "month-first"): ParsedTask {
  const text = input.trim().replace(/\s+/g, " ");
  const parser = order === "day-first" ? chrono.en.GB : chrono.casual;
  const results = parser.parse(text, now, { forwardDate: true });
  const result = results[results.length - 1];
  if (!result) return { text };

  let rest = `${text.slice(0, result.index)} ${text.slice(result.index + result.text.length)}`
    .replace(/\s+/g, " ")
    .trim();
  while (DANGLING_END.test(rest)) rest = rest.replace(DANGLING_END, "").trim();
  rest = rest.replace(DANGLING_START, "").trim();
  if (!rest) return { text };

  const start = result.start;
  const date = start.date();
  if (!start.isCertain("hour")) return { text: rest, due: { date: localDate(date) } };

  const hour = start.get("hour") ?? 0;
  if (!start.isCertain("meridiem") && hour >= 1 && hour <= 7) {
    const dayGiven = start.isCertain("day") || start.isCertain("weekday");
    const base = dayGiven ? date : now;
    let afternoon = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour + 12, start.get("minute") ?? 0);
    if (!dayGiven && afternoon <= now) afternoon = new Date(afternoon.getTime() + DAY_MS);
    return { text: rest, due: dueFrom(afternoon, false) };
  }
  return { text: rest, due: dueFrom(date, false) };
}

/** Whole days from today to the due date: 0 today, 1 tomorrow, -1 yesterday. */
export function daysUntil(due: Due, now: Date): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [year, month, day] = due.date.split("-").map(Number);
  return Math.round((new Date(year, month - 1, day).getTime() - today.getTime()) / DAY_MS);
}

/** Sorts undated tasks last, all-day tasks before timed ones on the same day. */
export function compareDue(a: Due | undefined, b: Due | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (!a.time || !b.time) return a.time ? 1 : b.time ? -1 : 0;
  return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
}

export type GroupKey = "overdue" | "today" | "tomorrow" | "soon" | "later" | "none";

export interface DueGroup {
  /** Stable id, e.g. "today" or "soon:2026-09-25". */
  id: string;
  key: GroupKey;
  title: string;
  /** Sort order of the group. */
  rank: number;
}

const weekdayDay = (date: Date) => `${WEEKDAYS[date.getDay()]} ${date.getDate()}`;

/** Overdue, Today, Tomorrow, each of the next five days, Later, or No date. */
export function groupOf(due: Due | undefined, now: Date): DueGroup {
  if (!due) return { id: "none", key: "none", title: "No date", rank: 1000 };
  const days = daysUntil(due, now);
  const date = dueDate(due);
  if (days < 0) return { id: "overdue", key: "overdue", title: "Overdue", rank: -1 };
  if (days === 0) return { id: "today", key: "today", title: `Today · ${weekdayDay(date)}`, rank: 0 };
  if (days === 1) return { id: "tomorrow", key: "tomorrow", title: `Tomorrow · ${weekdayDay(date)}`, rank: 1 };
  if (days <= 6) return { id: `soon:${due.date}`, key: "soon", title: weekdayDay(date), rank: days };
  return { id: "later", key: "later", title: "Later", rank: 100 };
}

function monthDay(date: Date, order: DateOrder, now: Date): string {
  const text =
    order === "day-first"
      ? `${date.getDate()} ${MONTHS[date.getMonth()]}`
      : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? text : `${text} ${date.getFullYear()}`;
}

/** What a receipt prints next to a task, given the group it's in: the time within a day, a date otherwise. */
export function dueColumn(due: Due | undefined, now: Date, order: DateOrder = "month-first"): string {
  if (!due) return "";
  const days = daysUntil(due, now);
  const date = dueDate(due);
  const time = due.time ? ` ${due.time}` : "";
  if (days >= 0 && days <= 6) return due.time ?? "";
  if (days < 0 && days >= -6) return `${weekdayDay(date)}${time}`;
  return `${monthDay(date, order, now)}${time}`;
}

/** A standalone name for a due date, for list rows and HUDs: "Today 15:00", "Fri", "Sep 30". */
export function describeDue(due: Due, now: Date, order: DateOrder = "month-first"): string {
  const days = daysUntil(due, now);
  const date = dueDate(due);
  const time = due.time ? ` ${due.time}` : "";
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days === -1) return `Yesterday${time}`;
  if (days > 1 && days <= 6) return `${WEEKDAYS[date.getDay()]}${time}`;
  return `${monthDay(date, order, now)}${time}`;
}

export function isOverdue(due: Due | undefined, now: Date): boolean {
  if (!due) return false;
  const days = daysUntil(due, now);
  if (days !== 0) return days < 0;
  return !!due.time && dueDate(due) < now;
}
