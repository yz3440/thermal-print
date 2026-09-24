import {
  Action,
  ActionPanel,
  Color,
  Detail,
  Icon,
  Keyboard,
  openExtensionPreferences,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { blockingReason, type PrinterStatus } from "./core/escpos";
import { encodeFeedAndCut } from "./core/layout";
import { FALLBACK_MODEL, isModelId, modelFromIdentity, specFor, type ModelId } from "./core/models";
import { formatEndpoint, parseAddress, PrinterError, probe, sendJob, serialize, type Probe } from "./core/transport";
import { printingToast, showPrintResult } from "./ui/feedback";
import { print } from "./ui/printing";
import { printerSettings } from "./ui/settings";
import { ready, store } from "./ui/storage";

interface Check {
  address: string;
  probe: Probe;
  model: ModelId;
  /** How the model was chosen. */
  modelSource: string;
}

async function checkPrinter(address: string, setting: string): Promise<Check> {
  await ready();
  const endpoint = parseAddress(address);
  const key = formatEndpoint(endpoint);
  const result = await serialize(() => probe(endpoint));
  let model: ModelId;
  let modelSource: string;
  if (isModelId(setting)) {
    model = setting;
    modelSource = "Set in preferences";
  } else {
    const detected = modelFromIdentity(result.identity?.maker, result.identity?.model);
    const identity = [result.identity?.maker, result.identity?.model].filter(Boolean).join(" ") || undefined;
    if (result.identity) {
      await store.setPrinterCache(key, { model: detected ?? FALLBACK_MODEL, detected: !!detected, identity });
    }
    const cached = await store.printerCache(key);
    model = detected ?? (cached && isModelId(cached.model) ? cached.model : FALLBACK_MODEL);
    modelSource = detected
      ? "Detected"
      : `Not detected${identity ? ` (says “${identity}”)` : ""}, using the 80 mm default`;
  }
  return { address: key, probe: result, model, modelSource };
}

function statusLine(status: PrinterStatus | undefined): { text: string; color: Color } {
  if (!status) return { text: "Connected (the printer doesn't report its status)", color: Color.Blue };
  const reason = blockingReason(status);
  return reason ? { text: reason, color: Color.Red } : { text: "Ready", color: Color.Green };
}

const yesNo = (value: boolean, yes: string, no: string) => (value ? yes : no);

/** A one-page guide that doubles as a check of the printer's fonts and styles. */
function testPage(check: Check) {
  return {
    style: "memo" as const,
    title: "Thermal Print",
    body: [
      `This printer: ${specFor(check.model).name} at ${check.address}.`,
      "",
      "## To-do lists",
      "- **To-Do List**: type a task with a date, press Enter, repeat. Cmd+Enter prints the whole list.",
      "- **Add To-Do**: add a task from anywhere, e.g. call dentist tomorrow 3pm.",
      "- **Print To-Do List**: print the list with a hotkey.",
      "- Start or end a task with @name to put it on another list: oat milk @groceries",
      "",
      "## Dates it understands",
      "today, tonight, tomorrow 3pm, friday, next monday at 9, sep 30, in 2 weeks, 14:30",
      "",
      "## Also",
      "- **Compose Receipt**: notes and lists with a preview.",
      "- **Print Selection or Clipboard**: in Raycast Notes, select all, then run it with a hotkey.",
      "- **Receipt Library**: lists, drafts, pending jobs and history.",
      "",
      "**bold**, __underline__, ==highlight==",
    ].join("\n"),
  };
}

export default function PrinterStatusCommand() {
  const settings = printerSettings();
  const { data, isLoading, error, revalidate } = usePromise(checkPrinter, [settings.address, settings.model], {
    onError: () => undefined,
  });

  async function printTestPage() {
    if (!data) return;
    const toast = await printingToast("Printing test page…");
    const result = await print({ receipt: testPage(data), source: "status" });
    await showPrintResult(result, "test page", toast);
    revalidate();
  }

  async function feedAndCut() {
    if (!data) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: "Feeding…" });
    try {
      const bytes = encodeFeedAndCut(specFor(data.model), settings.cut);
      await serialize(() => sendJob(parseAddress(settings.address), bytes));
      toast.style = Toast.Style.Success;
      toast.title = settings.cut === "none" ? "Fed the paper" : "Fed and cut";
    } catch (caught) {
      toast.style = Toast.Style.Failure;
      toast.title = "Couldn't reach the printer";
      toast.message = caught instanceof Error ? caught.message : String(caught);
    }
  }

  const status = data?.probe.status;
  const line = statusLine(status);
  const spec = data ? specFor(data.model) : undefined;
  const printerError = error instanceof PrinterError ? error : undefined;

  const markdown = error
    ? [
        "# Can't reach the printer",
        error.message,
        printerError?.hint ?? "",
        "",
        "Check the **Printer Address** in the extension preferences.",
      ].join("\n\n")
    : data && spec
      ? [
          `# ${spec.name}`,
          `**${line.text}** at \`${data.address}\`, answered in ${data.probe.connectMs} ms.`,
          status?.paperNearEnd
            ? "The paper-low sensor says the roll is nearly empty. Many printers always say this, so it never stops a print."
            : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : "";

  return (
    <Detail
      isLoading={isLoading}
      navigationTitle="Printer Status"
      markdown={markdown}
      metadata={
        data && spec ? (
          <Detail.Metadata>
            <Detail.Metadata.TagList title="Status">
              <Detail.Metadata.TagList.Item
                text={status ? (line.color === Color.Green ? "Ready" : "Not ready") : "Connected"}
                color={line.color}
              />
            </Detail.Metadata.TagList>
            {status ? (
              <>
                <Detail.Metadata.Label title="Online" text={yesNo(status.online, "Yes", "No")} />
                <Detail.Metadata.Label title="Cover" text={yesNo(status.coverOpen, "Open", "Closed")} />
                <Detail.Metadata.Label
                  title="Paper"
                  text={status.paperOut ? "Out" : status.paperNearEnd ? "Present (low-paper sensor on)" : "Present"}
                />
                <Detail.Metadata.Label
                  title="Errors"
                  text={
                    [
                      status.cutterError && "cutter",
                      status.unrecoverableError && "hardware",
                      status.autoRecoverableError && "recovering",
                      status.error && "general",
                    ]
                      .filter(Boolean)
                      .join(", ") || "None"
                  }
                />
              </>
            ) : null}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label title="Model" text={spec.name} />
            <Detail.Metadata.Label title="Model Setting" text={data.modelSource} />
            {data.probe.identity?.firmware ? (
              <Detail.Metadata.Label title="Firmware" text={data.probe.identity.firmware} />
            ) : null}
            <Detail.Metadata.Label title="Paper Width" text={`${spec.columns} columns, ${spec.widthDots} dots`} />
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label title="Cut" text={settings.cut} />
            <Detail.Metadata.Label
              title="Numeric Dates"
              text={settings.dateOrder === "day-first" ? "Day/Month" : "Month/Day"}
            />
          </Detail.Metadata>
        ) : undefined
      }
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {data ? <Action title="Print Test Page" icon={Icon.Print} onAction={printTestPage} /> : null}
            <Action
              title="Check Again"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={revalidate}
            />
            {data ? (
              <Action
                title={settings.cut === "none" ? "Feed Paper" : "Feed and Cut"}
                icon={Icon.ArrowDown}
                shortcut={{ modifiers: ["cmd"], key: "t" }}
                onAction={feedAndCut}
              />
            ) : null}
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action title="Open Extension Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            {data ? (
              <Action.OpenInBrowser title="Open Printer Web Page" url={`http://${data.address.replace(/:\d+$/, "")}`} />
            ) : null}
            {data && settings.model === "auto" ? (
              <Action
                title="Detect Model Again"
                icon={Icon.MagnifyingGlass}
                onAction={async () => {
                  await store.clearPrinterCache(data.address);
                  revalidate();
                }}
              />
            ) : null}
            {data ? (
              <Action.CopyToClipboard
                title="Copy Diagnostics"
                content={JSON.stringify(
                  { address: data.address, model: data.model, modelSource: data.modelSource, probe: data.probe },
                  null,
                  2,
                )}
              />
            ) : null}
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
