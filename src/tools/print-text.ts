import type { Tool } from "@raycast/api";
import { receiptFromText } from "../core/text";
import type { Receipt } from "../core/types";
import { printConfirmation, printFromTool } from "../ui/tools";

type Input = {
  /**
   * The text to print. Markdown is understood: # headings, **bold**, - lists, - [ ] tasks and | tables |.
   * In a checklist, dates written in the lines ("call dentist tomorrow 3pm") are read out and the list is grouped by day.
   */
  text: string;
  /** An optional title, printed large at the top. */
  title?: string;
  /**
   * "memo" for notes and messages, "checklist" for one item per line, "ticket" for one short phrase printed as big
   * as possible, "plain" for the text exactly as given. Leave it out to pick automatically from the text.
   */
  style?: "memo" | "checklist" | "ticket" | "plain";
};

function receiptFor(input: Input): Receipt {
  const text = input.text?.trim() ?? "";
  if (!text && !input.title?.trim()) throw new Error("There is no text to print.");
  return receiptFromText(text, { title: input.title, style: input.style });
}

/** Prints text as a receipt: a note, a message, a list, or anything copied. */
export default async function printText(input: Input) {
  return printFromTool(receiptFor(input));
}

export const confirmation: Tool.Confirmation<Input> = async (input) => {
  const receipt = receiptFor(input);
  return printConfirmation(receipt, [
    { name: "Title", value: receipt.title },
    { name: "Style", value: receipt.style },
  ]);
};
