import { Detail, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import type { ReactNode } from "react";
import type { Receipt, Style } from "../core/types";
import { previewReceipt } from "./preview";

export const STYLE_NAMES: Record<Style, string> = {
  ticket: "Ticket",
  checklist: "Checklist",
  memo: "Memo",
  plain: "Plain",
  document: "Document",
};

export function ReceiptPreviewDetail(props: { receipt: Receipt; navigationTitle?: string; actions?: ReactNode }) {
  const { data, isLoading, error } = usePromise(previewReceipt, [props.receipt]);
  return (
    <Detail
      isLoading={isLoading}
      navigationTitle={props.navigationTitle ?? "Receipt Preview"}
      markdown={error ? `Couldn't draw the preview: ${error.message}` : (data?.markdown ?? "")}
      metadata={
        data && (
          <Detail.Metadata>
            <Detail.Metadata.Label title="Style" text={STYLE_NAMES[props.receipt.style]} />
            <Detail.Metadata.Label title="Paper" text={`${(data.lengthMm / 10).toFixed(1)} cm`} />
            <Detail.Metadata.Label title="Printer" text={data.spec.name} />
            {data.unsupported.length > 0 && (
              <Detail.Metadata.Label title="Prints as “?”" text={data.unsupported.join(" ")} icon={Icon.Warning} />
            )}
          </Detail.Metadata>
        )
      }
      actions={props.actions}
    />
  );
}
