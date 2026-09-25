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
import { specFor } from "./core/models";
import { parseAddress, PrinterError, sendJob, serialize } from "./core/transport";
import { printingToast, showPrintResult } from "./ui/feedback";
import { print } from "./ui/printing";
import { printerSettings } from "./ui/settings";
import { checkPrinter, type Check } from "./ui/status";
import { store } from "./ui/storage";

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
      "## Commands",
      "- **Compose Receipt**: notes and lists with a preview.",
      "- **Print Selection or Clipboard**: select text or images anywhere, then run it with a hotkey.",
      "- **Print Image**: photos and screenshots, dithered for thermal paper.",
      "- **Receipt Library**: drafts, pending jobs and history.",
      "",
      "## Lists with dates",
      "- [ ] call dentist tomorrow 3pm",
      "- [ ] pay rent sep 30",
      "",
      "## Raycast AI",
      "Ask it to print today's tasks, a note, or what's on the clipboard.",
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
          data.detected
            ? ""
            : "The printer didn't say what model it is, so receipts use the 80 mm default layout. If your paper is 58 mm wide or lines wrap oddly, pick your printer under **Printer Model** in the preferences.",
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
