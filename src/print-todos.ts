import { LaunchProps, showHUD } from "@raycast/api";
import { findList } from "./core/grammar";
import { openItems, receiptOf } from "./core/store";
import { announcePrintResult, printingToast } from "./ui/feedback";
import { print } from "./ui/printing";
import { ready, store } from "./ui/storage";

export default async function PrintTodos(props: LaunchProps<{ arguments: Arguments.PrintTodos }>) {
  await ready();
  const wanted = props.arguments.list?.trim().replace(/^@/, "");
  const lists = await store.lists();
  let list = await store.defaultList();
  if (wanted) {
    const match = findList(
      `@${wanted}`,
      lists.map((l) => ({ id: l.id, name: l.title ?? "" })),
    );
    const found = match && lists.find((l) => l.id === match.id);
    if (!found) {
      await showHUD(`No list called “${wanted}”`);
      return;
    }
    list = found;
  }

  const tasks = openItems(list.items);
  if (tasks.length === 0) {
    await showHUD(`${list.title} has no open tasks`);
    return;
  }
  const toast = await printingToast(`Printing ${list.title}…`);
  const result = await print({
    receipt: receiptOf(list),
    source: "list",
    fromId: list.id,
  });
  await announcePrintResult(result, `${list.title} · ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`, toast);
}
