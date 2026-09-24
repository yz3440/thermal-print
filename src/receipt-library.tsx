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
import { useState } from "react";
import { compareDue, describeDue } from "./core/dates";
import { newId, openItems, receiptOf, type RecordKind, type StoredReceipt } from "./core/store";
import { summarize } from "./core/text";
import type { Style } from "./core/types";
import { ComposeForm } from "./ui/ComposeForm";
import { printingToast, showPrintResult } from "./ui/feedback";
import { ListNameForm } from "./ui/ListNameForm";
import { PreviewPane } from "./ui/PreviewPane";
import { STYLE_NAMES } from "./ui/ReceiptPreviewDetail";
import { print } from "./ui/printing";
import { printerSettings } from "./ui/settings";
import { ready, store } from "./ui/storage";
import { TodoList } from "./ui/TodoList";

type Filter = "all" | RecordKind;

const SECTIONS: { kind: RecordKind; title: string }[] = [
  { kind: "list", title: "Lists" },
  { kind: "draft", title: "Drafts" },
  { kind: "pending", title: "Pending" },
  { kind: "history", title: "History" },
];

const STYLE_ICONS: Record<Style, Icon> = {
  ticket: Icon.Receipt,
  checklist: Icon.BulletPoints,
  memo: Icon.Document,
  plain: Icon.Text,
  document: Icon.Image,
};

function iconFor(record: StoredReceipt): Image.ImageLike {
  if (record.kind === "list") return { source: Icon.BulletPoints, tintColor: Color.Blue };
  if (record.kind === "pending") return { source: Icon.Warning, tintColor: Color.Orange };
  if (record.kind === "draft") return { source: STYLE_ICONS[record.style], tintColor: Color.Purple };
  return STYLE_ICONS[record.style];
}

function titleOf(record: StoredReceipt): string {
  return record.kind === "list" ? (record.title ?? "List") : summarize(record.title, record.body);
}

function markdownOf(record: StoredReceipt): string {
  const { title, body } = receiptOf(record);
  return title ? `# ${title}\n${body}` : body;
}

export default function ReceiptLibrary() {
  const {
    data: records = [],
    isLoading,
    revalidate,
  } = usePromise(async () => {
    await ready();
    return store.all();
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [showDetail, setShowDetail] = useCachedState("library.detail", true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visible = records.filter((record) => filter === "all" || record.kind === filter);
  const pinned = visible.filter((record) => record.pinned);

  async function printRecord(record: StoredReceipt) {
    if (record.kind === "list" && openItems(record.items).length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "The list has no open tasks" });
      return;
    }
    const toast = await printingToast();
    const result = await print({
      receipt: receiptOf(record),
      source: "library",
      fromId: record.id,
    });
    await showPrintResult(result, titleOf(record), toast);
    if (result.ok && record.kind === "list") {
      toast.primaryAction = {
        title: "Clear List",
        onAction: async () => {
          const latest = await store.get(record.id);
          if (latest) await store.save({ ...latest, items: [] });
          toast.hide();
          revalidate();
        },
      };
    }
    revalidate();
  }

  async function printAllPending() {
    const pending = records.filter((record) => record.kind === "pending").reverse();
    const toast = await printingToast(`Printing ${pending.length} pending…`);
    let printed = 0;
    for (const record of pending) {
      const result = await print({
        receipt: receiptOf(record),
        source: "library",
        fromId: record.id,
      });
      if (!result.ok) {
        await showPrintResult(result, undefined, toast);
        toast.title = `Printed ${printed} of ${pending.length}, then stopped`;
        revalidate();
        return;
      }
      printed++;
    }
    toast.style = Toast.Style.Success;
    toast.title = `Printed ${printed} pending`;
    revalidate();
  }

  async function duplicate(record: StoredReceipt) {
    await store.create({
      kind: record.kind === "list" ? "list" : "draft",
      style: record.style,
      title: record.title ? `${record.title} copy` : undefined,
      body: record.body,
      items: record.items?.map((item) => ({ ...item, id: newId() })),
      source: "library",
    });
    await showToast({ style: Toast.Style.Success, title: "Duplicated" });
    revalidate();
  }

  async function remove(record: StoredReceipt) {
    if (record.kind !== "history") {
      const ok = await confirmAlert({
        title: `Delete “${titleOf(record)}”?`,
        message: record.kind === "list" ? `It has ${record.items?.length ?? 0} items.` : undefined,
        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
      });
      if (!ok) return;
    }
    await store.remove(record.id);
    revalidate();
  }

  const newActions = (
    <ActionPanel.Section>
      <Action.Push
        title="New Receipt"
        icon={Icon.NewDocument}
        shortcut={Keyboard.Shortcut.Common.New}
        target={<ComposeForm onDone={revalidate} />}
      />
      <Action.Push
        title="New List"
        icon={Icon.BulletPoints}
        shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
        target={<ListNameForm onSaved={revalidate} />}
      />
    </ActionPanel.Section>
  );

  function item(record: StoredReceipt) {
    const when = record.printedAt ?? record.updatedAt;
    const accessories: List.Item.Accessory[] = [];
    if (record.kind === "list") {
      const open = openItems(record.items);
      const next = open.map((item) => item.due).sort(compareDue)[0];
      if (next) accessories.push({ tag: describeDue(next, new Date(), printerSettings().dateOrder) });
      accessories.push({ text: `${open.length} open` });
    }
    if (record.maybePrinted) accessories.push({ tag: { value: "may have printed", color: Color.Yellow } });
    if (!showDetail) accessories.push({ date: new Date(when), tooltip: new Date(when).toLocaleString() });

    const primary =
      record.kind === "list" ? (
        <Action.Push
          title="Open List"
          icon={Icon.List}
          target={<TodoList listId={record.id} onChange={revalidate} />}
        />
      ) : (
        <Action
          title={record.kind === "history" ? "Reprint" : "Print"}
          icon={Icon.Print}
          onAction={() => printRecord(record)}
        />
      );

    return (
      <List.Item
        key={record.id}
        id={record.id}
        title={titleOf(record)}
        subtitle={showDetail ? undefined : record.kind === "pending" ? record.error : STYLE_NAMES[record.style]}
        keywords={markdownOf(record).split(/\s+/).slice(0, 80)}
        icon={iconFor(record)}
        accessories={accessories}
        detail={
          showDetail && selectedId === record.id ? (
            <PreviewPane
              receipt={receiptOf(record)}
              placeholder={record.kind === "list" ? "An empty list." : undefined}
              metadata={(preview) => (
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label
                    title="Kind"
                    text={record.kind === "list" ? "List" : `${STYLE_NAMES[record.style]} · ${record.kind}`}
                  />
                  {record.error ? (
                    <List.Item.Detail.Metadata.Label title="Why it didn't print" text={record.error} />
                  ) : null}
                  <List.Item.Detail.Metadata.Label title="Changed" text={new Date(record.updatedAt).toLocaleString()} />
                  {record.printedAt ? (
                    <List.Item.Detail.Metadata.Label
                      title="Printed"
                      text={new Date(record.printedAt).toLocaleString()}
                    />
                  ) : null}
                  {preview ? (
                    <List.Item.Detail.Metadata.Label title="Paper" text={`${(preview.lengthMm / 10).toFixed(1)} cm`} />
                  ) : null}
                </List.Item.Detail.Metadata>
              )}
            />
          ) : undefined
        }
        actions={
          <ActionPanel>
            <ActionPanel.Section>
              {primary}
              {record.kind === "list" ? (
                <Action
                  title="Print List"
                  icon={Icon.Print}
                  shortcut={{ modifiers: ["cmd"], key: "return" }}
                  onAction={() => printRecord(record)}
                />
              ) : null}
              {record.kind === "list" ? (
                <Action.Push
                  title="Rename List"
                  icon={Icon.Pencil}
                  shortcut={Keyboard.Shortcut.Common.Edit}
                  target={<ListNameForm list={record} onSaved={revalidate} />}
                />
              ) : (
                <Action.Push
                  title={record.kind === "history" ? "Edit as New Draft" : "Edit"}
                  icon={Icon.Pencil}
                  shortcut={Keyboard.Shortcut.Common.Edit}
                  target={<ComposeForm record={record} onDone={revalidate} />}
                />
              )}
              {record.kind === "pending" ? (
                <Action title="Print All Pending" icon={Icon.Print} onAction={printAllPending} />
              ) : null}
            </ActionPanel.Section>
            <ActionPanel.Section>
              <Action
                title={record.pinned ? "Unpin" : "Pin"}
                icon={record.pinned ? Icon.PinDisabled : Icon.Pin}
                shortcut={Keyboard.Shortcut.Common.Pin}
                onAction={async () => {
                  await store.save({ ...record, pinned: !record.pinned });
                  revalidate();
                }}
              />
              <Action
                title="Duplicate"
                icon={Icon.Duplicate}
                shortcut={Keyboard.Shortcut.Common.Duplicate}
                onAction={() => duplicate(record)}
              />
              <Action.CopyToClipboard
                title="Copy Text"
                content={markdownOf(record)}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
              <Action
                title={showDetail ? "Hide Preview" : "Show Preview"}
                icon={Icon.Sidebar}
                shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                onAction={() => setShowDetail(!showDetail)}
              />
              <Action
                title="Delete"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => remove(record)}
              />
            </ActionPanel.Section>
            {newActions}
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail && visible.length > 0}
      onSelectionChange={setSelectedId}
      searchBarPlaceholder="Search lists, drafts and history"
      searchBarAccessory={
        <List.Dropdown tooltip="Show" storeValue onChange={(value) => setFilter(value as Filter)}>
          <List.Dropdown.Item title="Everything" value="all" icon={Icon.Tray} />
          <List.Dropdown.Item title="Lists" value="list" icon={Icon.BulletPoints} />
          <List.Dropdown.Item title="Drafts" value="draft" icon={Icon.Document} />
          <List.Dropdown.Item title="Pending" value="pending" icon={Icon.Warning} />
          <List.Dropdown.Item title="History" value="history" icon={Icon.Clock} />
        </List.Dropdown>
      }
      actions={<ActionPanel>{newActions}</ActionPanel>}
    >
      {pinned.length ? <List.Section title="Pinned">{pinned.map(item)}</List.Section> : null}
      {SECTIONS.map(({ kind, title }) => {
        const records = visible.filter((record) => record.kind === kind && !record.pinned);
        return records.length ? (
          <List.Section key={kind} title={title} subtitle={String(records.length)}>
            {records.map(item)}
          </List.Section>
        ) : null;
      })}
      <List.EmptyView
        icon={Icon.Receipt}
        title={filter === "all" ? "Nothing here yet" : "Nothing in this view"}
        description="Press ⌘N for a new receipt or ⌘⇧N for a new list. Printed receipts show up here too."
      />
    </List>
  );
}
