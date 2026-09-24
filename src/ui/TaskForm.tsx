import { Action, ActionPanel, Form, Icon, useNavigation } from "@raycast/api";
import { useState } from "react";
import { dueDate, dueFrom } from "../core/dates";
import type { ListItem } from "../core/store";
import { store } from "./storage";

/** Edits one task's text and due date. */
export function TaskForm(props: { listId: string; item: ListItem; onSaved?: () => void }) {
  const { pop } = useNavigation();
  const [date, setDate] = useState<Date | null>(props.item.due ? dueDate(props.item.due) : null);
  const [allDay, setAllDay] = useState(props.item.due ? !props.item.due.time : false);
  const [error, setError] = useState<string>();

  async function submit(values: { text: string }) {
    const text = values.text.trim();
    if (!text) {
      setError("A task needs some text");
      return;
    }
    const due = date ? dueFrom(date, allDay || Form.DatePicker.isFullDay(date)) : undefined;
    await store.updateItem(props.listId, props.item.id, { text, due });
    props.onSaved?.();
    pop();
  }

  return (
    <Form
      navigationTitle="Edit Task"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Task" icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="text"
        title="Task"
        defaultValue={props.item.text}
        error={error}
        onChange={() => error && setError(undefined)}
        autoFocus
      />
      <Form.DatePicker id="due" title="Due" value={date} onChange={setDate} />
      <Form.Checkbox id="allDay" label="No specific time" value={allDay} onChange={setAllDay} />
    </Form>
  );
}
