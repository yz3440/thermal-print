import { List } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { ReactNode } from "react";
import type { Receipt } from "../core/types";
import { previewReceipt, type ReceiptPreview } from "./preview";

/** The detail pane of a list row: the receipt as it will print. Render it for the selected row only. */
export function PreviewPane(props: {
  receipt?: Receipt;
  placeholder?: string;
  metadata?: (preview: ReceiptPreview | undefined) => ReactNode;
}) {
  const { data, isLoading, error } = usePromise(
    async (receipt: Receipt | undefined) => (receipt ? previewReceipt(receipt) : undefined),
    [props.receipt],
  );
  const markdown = error ? `Couldn't draw the preview: ${error.message}` : (data?.markdown ?? props.placeholder ?? "");
  return <List.Item.Detail isLoading={isLoading} markdown={markdown} metadata={props.metadata?.(data)} />;
}
