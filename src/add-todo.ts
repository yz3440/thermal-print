import { launchCommand, LaunchProps, LaunchType, showHUD } from "@raycast/api";
import { describeDue, parseTask } from "./core/dates";
import { parseQuickInput } from "./core/grammar";
import { openItems } from "./core/store";
import { printerSettings } from "./ui/settings";
import { ready, store } from "./ui/storage";

export default async function AddTodo(props: LaunchProps<{ arguments: Arguments.AddTodo }>) {
  const raw = (props.arguments.text || props.fallbackText || "").trim();
  if (!raw) {
    await launchCommand({ name: "todo-list", type: LaunchType.UserInitiated });
    return;
  }

  await ready();
  const { dateOrder } = printerSettings();
  const lists = await store.lists();
  const input = parseQuickInput(
    raw,
    lists.map((list) => ({ id: list.id, name: list.title ?? "" })),
  );
  const listId = input.list?.id ?? (await store.defaultList()).id;
  const now = new Date();
  const task = parseTask(input.text, now, dateOrder);
  const list = await store.addToList(listId, task.text, task.due);

  const when = task.due ? ` · ${describeDue(task.due, now, dateOrder)}` : "";
  const open = openItems(list.items).length;
  await showHUD(`Added to ${list.title}: ${task.text}${when} (${open} open)`);
}
