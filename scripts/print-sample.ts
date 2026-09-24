/**
 * Prints a sample to-do list (dates relative to now) through the same pipeline the commands use,
 * with a throwaway store, so layout changes can be checked on real paper.
 *
 * Usage: npm run print-sample -- <printer address> [model]
 */
import { localDate, parseTask } from "../src/core/dates";
import { printReceipt } from "../src/core/print";
import { receiptOf, Store } from "../src/core/store";
import { MemoryKV } from "../tests/harness/memory-kv";

async function main() {
  const [address, model = "auto"] = process.argv.slice(2);
  if (!address) throw new Error("Usage: npm run print-sample -- <printer address> [model]");
  const now = new Date();
  const store = new Store(new MemoryKV());
  const list = await store.defaultList();

  const yesterday = new Date(now.getTime() - 86_400_000);
  await store.addToList(list.id, "Send the invoice to Acme", { date: localDate(yesterday) });
  for (const line of [
    "call the dentist tomorrow 3pm",
    "gym tomorrow at 7am",
    "submit the quarterly report to the department office in 2 days",
    "pay rent in 10 days",
    "buy oat milk",
    "water the plants",
  ]) {
    const task = parseTask(line, now);
    await store.addToList(list.id, task.text, task.due);
  }
  await store.addToList(list.id, "Review the pull request", { date: localDate(now), time: "23:30" });

  const saved = (await store.get(list.id))!;
  const result = await printReceipt(
    store,
    { address, model, cut: "partial", dateOrder: "month-first" },
    { receipt: receiptOf(saved), source: "list", fromId: saved.id },
  );
  if (result.ok) console.log(`Printed ${saved.items?.length} tasks on ${result.spec.name} in ${result.ms} ms`);
  else console.error(`Not printed: ${result.error.message} ${result.error.hint ?? ""}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
