import {
  Action,
  ActionPanel,
  Alert,
  Color,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  type Image,
} from "@raycast/api";
import { useCachedState, usePromise } from "@raycast/utils";
import { useRef, useState } from "react";
import { compareDue, describeDue, dueFrom, groupOf, isOverdue, parseTask } from "../core/dates";
import { parseQuickInput, type ListRef } from "../core/grammar";
import { openItems, receiptOf, type ListItem, type StoredReceipt } from "../core/store";
import type { Receipt } from "../core/types";
import { printingToast, showPrintResult } from "./feedback";
import { ListNameForm } from "./ListNameForm";
import { PreviewPane } from "./PreviewPane";
import { print } from "./printing";
import { printerSettings } from "./settings";
import { ready, store } from "./storage";
import { TaskForm } from "./TaskForm";

/** Pressing ↵ twice on the same text this quickly adds it once. */
const REPEAT_GUARD_MS = 1500;
const TYPED = "typed";

interface Props {
  /** Show this list. Without it the view shows the list picked in its dropdown, the default list at first. */
  listId?: string;
  /** Text to start with, e.g. from a fallback search. */
  initialText?: string;
  onChange?: () => void;
}

interface Loaded {
  lists: StoredReceipt[];
  list: StoredReceipt;
  defaultId: string;
}

async function load(fixedId?: string, pickedId?: string): Promise<Loaded> {
  await ready();
  const fallback = await store.defaultList();
  const lists = await store.lists();
  const list = lists.find((l) => l.id === (fixedId ?? pickedId)) ?? fallback;
  return { lists, list, defaultId: fallback.id };
}

const refsOf = (lists: StoredReceipt[]): ListRef[] => lists.map((list) => ({ id: list.id, name: list.title ?? "" }));

export function TodoList({ listId: fixedId, initialText, onChange }: Props) {
  const settings = printerSettings();
  const [text, setText] = useState(initialText ?? "");
  const textRef = useRef(text);
  const lastAdd = useRef<{ text: string; at: number } | undefined>(undefined);
  const [pickedId, setPickedId] = useCachedState<string>("todo.list", "");
  const [showPreview, setShowPreview] = useCachedState("todo.preview", false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data, isLoading, revalidate } = usePromise(load, [fixedId, pickedId || undefined]);

  const now = new Date();
  const list = data?.list;
  const name = list?.title ?? "To-Do";
  const items = list?.items ?? [];
  const open = openItems(items);
  const done = items.filter((item) => item.done).sort((a, b) => ((a.doneAt ?? "") < (b.doneAt ?? "") ? 1 : -1));

  const quick = parseQuickInput(text, refsOf(data?.lists ?? []));
  const typed = parseTask(quick.text, now, settings.dateOrder);
  const target = quick.list ?? (list ? { id: list.id, name } : undefined);

  const changed = () => {
    revalidate();
    onChange?.();
  };

  const changeText = (value: string) => {
    setText(value);
    textRef.current = value;
  };

  async function add(withDate = true) {
    const raw = textRef.current.trim();
    if (!raw || !data) return;
    const at = Date.now();
    if (lastAdd.current?.text === raw && at - lastAdd.current.at < REPEAT_GUARD_MS) return;
    lastAdd.current = { text: raw, at };
    changeText("");

    const input = parseQuickInput(raw, refsOf(data.lists));
    const destination = input.list ?? { id: data.list.id, name };
    const task = withDate ? parseTask(input.text, new Date(), settings.dateOrder) : { text: input.text };
    await store.addToList(destination.id, task.text, "due" in task ? task.due : undefined);
    if (destination.id !== data.list.id) {
      await showToast({ style: Toast.Style.Success, title: `Added to ${destination.name}`, message: task.text });
    }
    changed();
  }

  async function printList() {
    if (!list) return;
    const current = (await store.get(list.id)) ?? list;
    const tasks = openItems(current.items);
    if (tasks.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: `${name} has no open tasks` });
      return;
    }
    const toast = await printingToast(`Printing ${name}…`);
    const result = await print({
      receipt: receiptOf(current),
      source: "list",
      fromId: current.id,
    });
    await showPrintResult(result, `${name} · ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`, toast);
    if (result.ok) {
      toast.primaryAction = {
        title: "Clear List",
        onAction: async () => {
          await store.clearList(current.id);
          toast.hide();
          changed();
        },
      };
    }
    changed();
  }

  async function setDone(item: ListItem, value: boolean) {
    if (!list) return;
    await store.setDone(list.id, item.id, value);
    changed();
    if (value) {
      await showToast({
        style: Toast.Style.Success,
        title: "Done",
        message: item.text,
        primaryAction: {
          title: "Undo",
          onAction: async (toast) => {
            await store.setDone(list.id, item.id, false);
            toast.hide();
            changed();
          },
        },
      });
    }
  }

  async function setDue(item: ListItem, date: Date | null) {
    if (!list) return;
    const due = date ? dueFrom(date, Action.PickDate.isFullDay(date)) : undefined;
    await store.updateItem(list.id, item.id, { due });
    changed();
  }

  async function removeItem(item: ListItem) {
    if (!list) return;
    await store.removeItem(list.id, item.id);
    changed();
  }

  async function clearDone() {
    if (!list) return;
    await store.clearDone(list.id);
    changed();
  }

  async function clearList() {
    if (!list) return;
    const ok = await confirmAlert({
      title: `Clear ${name}?`,
      message: `Removes all ${items.length} tasks. The list itself stays.`,
      primaryAction: { title: "Clear", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    await store.clearList(list.id);
    changed();
  }

  // The preview shows the whole list as it will print, with the task being typed already on it.
  const previewReceipt = (withTyped: boolean): Receipt | undefined => {
    if (!list) return undefined;
    if (!withTyped || !typed.text || quick.list) return receiptOf(list);
    const draft: StoredReceipt = { ...list, items: [...items, { id: TYPED, text: typed.text, due: typed.due }] };
    return receiptOf(draft);
  };
  const detail = (id: string) =>
    showPreview && (selectedId === id || selectedId === null) ? (
      <PreviewPane receipt={previewReceipt(id === TYPED)} placeholder="Nothing to print yet." />
    ) : undefined;

  const printAction = (
    <Action
      title={`Print ${name}`}
      icon={Icon.Print}
      shortcut={{ modifiers: ["cmd"], key: "return" }}
      onAction={printList}
    />
  );
  const previewAction = (
    <Action
      title={showPreview ? "Hide Receipt Preview" : "Show Receipt Preview"}
      icon={Icon.Sidebar}
      shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
      onAction={() => setShowPreview(!showPreview)}
    />
  );
  const listActions = (
    <ActionPanel.Section title="List">
      <Action.Push
        title="New List"
        icon={Icon.NewDocument}
        shortcut={Keyboard.Shortcut.Common.New}
        target={
          <ListNameForm
            onSaved={(created) => {
              if (!fixedId) setPickedId(created.id);
              changed();
            }}
          />
        }
      />
      {list ? (
        <Action.Push title="Rename List" icon={Icon.Pencil} target={<ListNameForm list={list} onSaved={changed} />} />
      ) : null}
      {list && data && data.defaultId !== list.id ? (
        <Action
          title="Make Default List"
          icon={Icon.Star}
          onAction={async () => {
            await store.setDefaultList(list.id);
            await showToast({ style: Toast.Style.Success, title: `New tasks go to ${name} by default` });
            changed();
          }}
        />
      ) : null}
      {done.length ? (
        <Action
          title="Clear Done Tasks"
          icon={Icon.CheckCircle}
          shortcut={Keyboard.Shortcut.Common.RemoveAll}
          onAction={clearDone}
        />
      ) : null}
      {items.length ? (
        <Action title="Clear List" icon={Icon.XMarkCircle} style={Action.Style.Destructive} onAction={clearList} />
      ) : null}
    </ActionPanel.Section>
  );

  // Open tasks grouped by day, in the order they will print.
  const groups = new Map<string, { title: string; rank: number; items: ListItem[] }>();
  for (const item of open) {
    const group = groupOf(item.due, now);
    const entry = groups.get(group.id) ?? { title: group.title, rank: group.rank, items: [] };
    entry.items.push(item);
    groups.set(group.id, entry);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => a.rank - b.rank);

  function taskRow(item: ListItem) {
    const late = !item.done && isOverdue(item.due, now);
    const icon: Image.ImageLike = item.done
      ? { source: Icon.CheckCircle, tintColor: Color.Green }
      : { source: Icon.Circle, tintColor: late ? Color.Red : Color.SecondaryText };
    const accessories: List.Item.Accessory[] = item.due
      ? [
          {
            tag: {
              value: describeDue(item.due, now, settings.dateOrder),
              color: late ? Color.Red : groupOf(item.due, now).key === "today" ? Color.Orange : Color.SecondaryText,
            },
          },
        ]
      : [];
    return (
      <List.Item
        key={item.id}
        id={item.id}
        title={item.text}
        icon={icon}
        accessories={accessories}
        detail={detail(item.id)}
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              <Action.Push
                title="Edit Task"
                icon={Icon.Pencil}
                target={list ? <TaskForm listId={list.id} item={item} onSaved={changed} /> : undefined}
              />
              <Action
                title={item.done ? "Mark as Not Done" : "Mark as Done"}
                icon={item.done ? Icon.Circle : Icon.CheckCircle}
                shortcut={{ modifiers: ["cmd"], key: "d" }}
                onAction={() => setDone(item, !item.done)}
              />
              {printAction}
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action.PickDate
                title="Set Due Date…"
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                onChange={(date) => setDue(item, date)}
              />
              {item.due ? (
                <Action title="Remove Due Date" icon={Icon.Calendar} onAction={() => setDue(item, null)} />
              ) : null}
              {previewAction}
              <Action
                title="Delete Task"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => removeItem(item)}
              />
            </ActionPanel.Section>
            {listActions}
          </ActionPanel>
        }
      />
    );
  }

  const typedText = text.trim();

  return (
    <List
      isLoading={isLoading}
      filtering={false}
      searchText={text}
      onSearchTextChange={changeText}
      onSelectionChange={setSelectedId}
      isShowingDetail={showPreview}
      navigationTitle={`${name} · ${open.length} open`}
      searchBarPlaceholder={`Add to ${name}, like “call dentist tomorrow 3pm”`}
      searchBarAccessory={
        fixedId || !data ? undefined : (
          <List.Dropdown tooltip="List" value={data.list.id} onChange={(id) => id !== data.list.id && setPickedId(id)}>
            {data.lists.map((l) => (
              <List.Dropdown.Item
                key={l.id}
                value={l.id}
                title={l.title ?? "List"}
                icon={l.id === data.defaultId ? Icon.Star : Icon.List}
              />
            ))}
          </List.Dropdown>
        )
      }
    >
      {typedText && target ? (
        <List.Section title={`Add to ${target.name}`}>
          <List.Item
            id={TYPED}
            title={typed.text || quick.text}
            icon={Icon.PlusCircle}
            accessories={
              typed.due
                ? [{ tag: { value: describeDue(typed.due, now, settings.dateOrder), color: Color.Orange } }]
                : [{ text: "No date" }]
            }
            detail={detail(TYPED)}
            actions={
              <ActionPanel>
                <Action title="Add Task" icon={Icon.Plus} onAction={() => add(true)} />
                {printAction}
                {typed.due ? (
                  <Action
                    title="Add Without Date"
                    icon={Icon.Plus}
                    shortcut={{ modifiers: ["opt"], key: "return" }}
                    onAction={() => add(false)}
                  />
                ) : null}
                {previewAction}
                {listActions}
              </ActionPanel>
            }
          />
        </List.Section>
      ) : null}

      {sortedGroups.map((group) => (
        <List.Section key={group.title} title={group.title} subtitle={String(group.items.length)}>
          {group.items
            .map((item, position) => ({ item, position }))
            .sort((a, b) => compareDue(a.item.due, b.item.due) || a.position - b.position)
            .map(({ item }) => taskRow(item))}
        </List.Section>
      ))}

      {done.length ? (
        <List.Section title="Done" subtitle={String(done.length)}>
          {done.map(taskRow)}
        </List.Section>
      ) : null}

      {!typedText && !isLoading && items.length === 0 ? (
        <List.EmptyView
          icon={Icon.BulletPoints}
          title={`${name} is empty`}
          description="Type a task, like “call dentist tomorrow 3pm”, and press ↵. Press ⌘↵ to print the whole list."
          actions={<ActionPanel>{listActions}</ActionPanel>}
        />
      ) : null}
    </List>
  );
}
