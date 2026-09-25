/**
 * Prints a sample to-do list (dates relative to now) through the same pipeline the commands and
 * AI tools use, with a throwaway store, so layout changes can be checked on real paper.
 *
 * Usage: npm run print-sample -- <printer address> [model]
 */
import { localDate, parseTask, type Due } from "../src/core/dates";
import { printReceipt } from "../src/core/print";
import { itemsMarkdown, Store } from "../src/core/store";
import { MemoryKV } from "../tests/harness/memory-kv";

async function main() {
  const [address, model = "auto"] = process.argv.slice(2);
  if (!address) throw new Error("Usage: npm run print-sample -- <printer address> [model]");
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);

  const items: { text: string; due?: Due }[] = [
    { text: "Send the invoice to Acme", due: { date: localDate(yesterday) } },
  ];
  for (const line of [
    "call the dentist tomorrow 3pm",
    "gym tomorrow at 7am",
    "submit the quarterly report to the department office in 2 days",
    "pay rent in 10 days",
    "buy oat milk",
    "water the plants",
  ]) {
    items.push(parseTask(line, now));
  }
  items.push({ text: "Review the pull request", due: { date: localDate(now), time: "23:30" } });

  const result = await printReceipt(
    new Store(new MemoryKV()),
    { address, model, cut: "partial", dateOrder: "month-first" },
    {
      receipt: {
        style: "checklist",
        title: "To-Do",
        body: itemsMarkdown(items),
        items: items.map((item) => ({ text: item.text, checked: false, depth: 0, due: item.due })),
      },
      source: "ai",
    },
  );
  if (result.ok) console.log(`Printed ${items.length} tasks on ${result.spec.name} in ${result.ms} ms`);
  else console.error(`Not printed: ${result.error.message} ${result.error.hint ?? ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
