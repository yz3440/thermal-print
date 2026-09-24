import { launchCommand, LaunchType, showHUD } from "@raycast/api";
import { pictureBlocks } from "./core/layout";
import { cleanText, detectStyle } from "./core/text";
import { announcePrintResult, printingToast } from "./ui/feedback";
import { print } from "./ui/printing";
import { readSelectionOrClipboard } from "./ui/selection";
import { ready } from "./ui/storage";

/** Longer texts open in Compose for a look before they use up paper. */
const REVIEW_OVER_LINES = 60;

export default async function PrintSelection() {
  await ready();
  const source = await readSelectionOrClipboard();
  if (!source) {
    await showHUD("Select some text or images, or copy them, first");
    return;
  }
  if (source.kind === "other-files") {
    await showHUD("Only images can be printed from Finder");
    return;
  }

  if (source.kind === "images") {
    const names = source.files.map((file) => file.split("/").pop()).join(", ");
    const what = source.files.length === 1 ? "image" : `${source.files.length} images`;
    const toast = await printingToast(`Printing ${what}…`);
    const result = await print({
      receipt: {
        style: "document",
        title: names,
        body: names,
        blocks: pictureBlocks(source.files, { size: "full", look: "photo", tone: "normal", sideways: false }),
      },
      source: "image",
    });
    await announcePrintResult(result, `${what} from ${source.from}`, toast);
    return;
  }

  const text = cleanText(source.text).trim();
  if (text.split("\n").length > REVIEW_OVER_LINES) {
    await launchCommand({ name: "compose-receipt", type: LaunchType.UserInitiated, context: { body: text } });
    return;
  }
  const toast = await printingToast(`Printing ${source.from}…`);
  const result = await print({ receipt: { style: detectStyle(text), body: text }, source: "selection" });
  await announcePrintResult(result, source.from, toast);
}
