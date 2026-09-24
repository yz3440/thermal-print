import {
  Action,
  ActionPanel,
  Form,
  Icon,
  Keyboard,
  popToRoot,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import type { StoredReceipt } from "../core/store";
import { checklistFromText, detectStyle } from "../core/text";
import type { Receipt, Style } from "../core/types";
import { printedTitle, printingToast, showPrintResult } from "./feedback";
import { ReceiptPreviewDetail } from "./ReceiptPreviewDetail";
import { print } from "./printing";
import { printerSettings } from "./settings";
import { ready, store } from "./storage";

export type StyleChoice = "auto" | Style;

export interface ComposeValues {
  body: string;
  title: string;
  style: StyleChoice;
}

/** Turns form values into a receipt, picking the style when it's set to Auto. */
export function resolveReceipt(values: ComposeValues): Receipt {
  const title = values.title.trim() || undefined;
  if (values.style !== "auto") return { style: values.style, title, body: values.body };
  return { style: detectStyle(title ? `# ${title}\n${values.body}` : values.body), title, body: values.body };
}

interface Props {
  /** Starting values, for a draft being edited or text handed over by another command. */
  initial?: Partial<ComposeValues>;
  /** The Library record being edited. */
  record?: StoredReceipt;
  /** Top-level Compose command: keeps unsent text as a Raycast draft. */
  enableDrafts?: boolean;
  onDone?: () => void;
}

export function ComposeForm({ initial, record, enableDrafts, onDone }: Props) {
  const { pop } = useNavigation();
  const [values, setValues] = useState<ComposeValues>({
    body: initial?.body ?? record?.body ?? "",
    title: initial?.title ?? record?.title ?? "",
    style: initial?.style ?? (record ? record.style : "auto"),
  });
  const [bodyError, setBodyError] = useState<string>();
  // A failed print is kept in Pending; printing again updates that entry instead of adding another.
  const [pendingId, setPendingId] = useState(record?.kind === "pending" ? record.id : undefined);

  const { data: lists } = usePromise(async () => {
    await ready();
    const fallback = await store.defaultList();
    const all = await store.lists();
    return [fallback, ...all.filter((list) => list.id !== fallback.id)];
  });

  const set = (patch: Partial<ComposeValues>) => setValues((current) => ({ ...current, ...patch }));

  const finish = async (message: string) => {
    if (record || onDone) {
      onDone?.();
      pop();
      await showToast({ style: Toast.Style.Success, title: message });
    } else {
      await showHUD(message);
      await popToRoot();
    }
  };

  const valid = () => {
    if (values.body.trim() || values.title.trim()) return true;
    setBodyError("Write something first");
    return false;
  };

  async function printNow() {
    if (!valid()) return;
    const receipt = resolveReceipt(values);
    const toast = await printingToast();
    const result = await print({
      receipt,
      source: record ? "library" : "compose",
      fromId: pendingId ?? record?.id,
    });
    if (result.ok) {
      toast.hide();
      await finish(printedTitle(receipt.style === "checklist" ? "list" : "receipt"));
    } else {
      setPendingId(result.record.id);
      await showPrintResult(result, undefined, toast);
    }
  }

  /** Every line becomes a task on `list`, with its date read out of the text. */
  async function addLinesTo(list: StoredReceipt) {
    if (!valid()) return;
    const { dateOrder } = printerSettings();
    const { items } = checklistFromText(values.body, { now: new Date(), order: dateOrder });
    const tasks = items.filter((item) => !item.checked);
    for (const task of tasks) await store.addToList(list.id, task.text, task.due);
    await finish(`Added ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} to ${list.title}`);
  }

  async function save() {
    if (!valid()) return;
    const receipt = resolveReceipt(values);
    if (record && record.kind !== "history") {
      await store.save({ ...record, style: receipt.style, title: receipt.title, body: receipt.body });
    } else {
      await store.create({
        kind: "draft",
        style: receipt.style,
        title: receipt.title,
        body: receipt.body,
        source: "compose",
      });
    }
    await finish("Saved to Library");
  }

  return (
    <Form
      enableDrafts={enableDrafts}
      navigationTitle={record ? "Edit Receipt" : "Compose Receipt"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Print" icon={Icon.Print} onSubmit={printNow} />
          <Action.Push
            title="Preview"
            icon={Icon.Eye}
            shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
            target={<ReceiptPreviewDetail receipt={resolveReceipt(values)} />}
          />
          <Action.SubmitForm
            title={record && record.kind !== "history" ? "Save Changes" : "Save to Library"}
            icon={Icon.SaveDocument}
            shortcut={Keyboard.Shortcut.Common.Save}
            onSubmit={save}
          />
          {lists?.length ? (
            <ActionPanel.Submenu
              title="Add Lines as Tasks To"
              icon={Icon.BulletPoints}
              shortcut={{ modifiers: ["cmd"], key: "l" }}
            >
              {lists.map((list) => (
                <Action.SubmitForm
                  key={list.id}
                  title={list.title ?? "List"}
                  icon={Icon.List}
                  onSubmit={() => addLinesTo(list)}
                />
              ))}
            </ActionPanel.Submenu>
          ) : null}
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="body"
        title="Text"
        placeholder="A to-do list, one task per line (“call dentist tomorrow 3pm”), or a note"
        enableMarkdown
        autoFocus
        value={values.body}
        error={bodyError}
        onChange={(body) => {
          set({ body });
          if (bodyError) setBodyError(undefined);
        }}
      />
      <Form.TextField
        id="title"
        title="Title"
        placeholder="Optional; or start the text with # Title"
        value={values.title}
        onChange={(title) => set({ title })}
      />
      <Form.Dropdown
        id="style"
        title="Style"
        value={values.style}
        onChange={(style) => set({ style: style as StyleChoice })}
      >
        <Form.Dropdown.Item value="auto" title="Auto" icon={Icon.Stars} />
        <Form.Dropdown.Item value="memo" title="Memo" icon={Icon.Document} />
        <Form.Dropdown.Item value="checklist" title="To-Do List" icon={Icon.BulletPoints} />
        <Form.Dropdown.Item value="ticket" title="Ticket" icon={Icon.Receipt} />
        <Form.Dropdown.Item value="plain" title="Plain" icon={Icon.Text} />
      </Form.Dropdown>
      <Form.Description
        title="Formatting"
        text="To-Do List: one task per line; dates like “friday 3pm” group the list by day. Memo: **bold**, __underline__, ==highlight==, # headings, - lists, | tables |, and pictures on a line of their own: ![caption](~/Pictures/photo.jpg)."
      />
    </Form>
  );
}
