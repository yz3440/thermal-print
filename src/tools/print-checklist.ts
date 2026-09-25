import type { Tool } from "@raycast/api";
import type { Due } from "../core/dates";
import { itemsMarkdown } from "../core/store";
import type { Receipt } from "../core/types";
import { printConfirmation, printFromTool } from "../ui/tools";

type Input = {
  /** The items to print, in the order given. */
  items: {
    /** The task or item itself, without its date. */
    text: string;
    /** The due date as YYYY-MM-DD, when there is one. */
    date?: string;
    /** The due time as HH:MM in 24-hour form, when there is one. Only used together with `date`. */
    time?: string;
    /** True for an item that is already done; it prints with a ticked box. */
    done?: boolean;
  }[];
  /** A short title printed at the top, such as "Today" or "Groceries". Defaults to "To-Do". */
  title?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

function dueOf(date: string | undefined, time: string | undefined): Due | undefined {
  if (!date) return undefined;
  if (!DATE.test(date)) throw new Error(`Dates must be YYYY-MM-DD, not “${date}”.`);
  const parts = time?.match(TIME);
  if (time && !parts) throw new Error(`Times must be HH:MM in 24-hour form, not “${time}”.`);
  return parts ? { date, time: `${parts[1].padStart(2, "0")}:${parts[2]}` } : { date };
}

function receiptFor(input: Input): Receipt {
  if (!input.items?.length) throw new Error("There are no items to print.");
  const items = input.items.map((item) => {
    const text = item.text?.trim();
    if (!text) throw new Error("Every item needs some text.");
    return { text, due: dueOf(item.date, item.time), done: !!item.done };
  });
  return {
    style: "checklist",
    title: input.title?.trim() || "To-Do",
    body: itemsMarkdown(items),
    items: items.map((item) => ({ text: item.text, checked: item.done, depth: 0, due: item.due })),
  };
}

/** Prints the items as one checklist receipt, grouped by day when they have due dates. */
export default async function printChecklist(input: Input) {
  return printFromTool(receiptFor(input));
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const receipt = receiptFor(input);
  return printConfirmation(receipt, [
    { name: "Title", value: receipt.title },
    { name: "Items", value: String(input.items.length) },
  ]);
};
