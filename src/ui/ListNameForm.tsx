import { Action, ActionPanel, Form, Icon, showToast, Toast, useNavigation } from "@raycast/api";
import { useState } from "react";
import { listKey } from "../core/grammar";
import type { StoredReceipt } from "../core/store";
import { store } from "./storage";

/** Creates a list, or renames `list`. */
export function ListNameForm(props: { list?: StoredReceipt; onSaved?: (list: StoredReceipt) => void }) {
  const { pop } = useNavigation();
  const [error, setError] = useState<string>();

  async function submit(values: { name: string }) {
    const name = values.name.trim();
    if (!listKey(name)) {
      setError("Use at least one letter or digit");
      return;
    }
    const clash = (await store.lists()).find(
      (list) => list.id !== props.list?.id && listKey(list.title ?? "") === listKey(name),
    );
    if (clash) {
      setError(`There's already a list called ${clash.title}`);
      return;
    }
    const saved = props.list ? await store.save({ ...props.list, title: name }) : await store.createList(name);
    await showToast({ style: Toast.Style.Success, title: props.list ? "Renamed list" : `Created ${name}` });
    props.onSaved?.(saved);
    pop();
  }

  return (
    <Form
      navigationTitle={props.list ? "Rename List" : "New List"}
      actions={
        <ActionPanel>
          <Action.SubmitForm title={props.list ? "Rename List" : "Create List"} icon={Icon.Check} onSubmit={submit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="Groceries"
        defaultValue={props.list?.title}
        error={error}
        onChange={() => error && setError(undefined)}
        autoFocus
      />
      <Form.Description text="Add to a list from anywhere by starting or ending a ticket with @name, like “oat milk @groceries”." />
    </Form>
  );
}
