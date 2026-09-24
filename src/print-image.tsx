import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  getSelectedFinderItems,
  Icon,
  Keyboard,
  LaunchProps,
  popToRoot,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
import { fileURLToPath } from "node:url";
import { pictureBlocks, type ImageLook, type ImageTone, type PictureOptions } from "./core/layout";
import type { Receipt } from "./core/types";
import { isImageFile, saveClipboardImage } from "./platform/macos";
import { printingToast, showPrintResult } from "./ui/feedback";
import { clipboardImages, print } from "./ui/printing";
import { ReceiptPreviewDetail } from "./ui/ReceiptPreviewDetail";
import { ready } from "./ui/storage";

interface Values extends PictureOptions {
  files: string[];
  caption: string;
}

/** Images to start with: selected in Finder, or on the clipboard (a copied file, or a screenshot). */
async function startingImages(): Promise<string[]> {
  try {
    const files = (await getSelectedFinderItems()).map((item) => item.path).filter(isImageFile);
    if (files.length) return files;
  } catch {
    // Finder isn't the frontmost app.
  }
  const clipboard = await Clipboard.read();
  if (clipboard.file) {
    const file = clipboard.file.startsWith("file://") ? fileURLToPath(clipboard.file) : clipboard.file;
    if (isImageFile(file)) return [file];
  }
  const image = await saveClipboardImage(clipboardImages);
  return image ? [image] : [];
}

const names = (files: string[]) => files.map((file) => file.split("/").pop()).join(", ");

function receiptFor(values: Values): Receipt {
  return {
    style: "document",
    title: values.caption.trim() || names(values.files),
    body: names(values.files),
    blocks: pictureBlocks(values.files, values),
  };
}

export default function PrintImage(props: LaunchProps<{ launchContext: { files?: string[] } }>) {
  const [values, setValues] = useState<Values>({
    files: props.launchContext?.files ?? [],
    size: "full",
    look: "photo",
    tone: "normal",
    sideways: false,
    caption: "",
  });
  const [filesError, setFilesError] = useState<string>();
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  const { isLoading } = usePromise(async () => {
    if (props.launchContext?.files?.length) return;
    const files = await startingImages();
    if (files.length) setValues((current) => (current.files.length ? current : { ...current, files }));
  });

  async function useClipboardImage() {
    const image = await saveClipboardImage(clipboardImages);
    if (!image) {
      await showToast({ style: Toast.Style.Failure, title: "There's no image on the clipboard" });
      return;
    }
    set({ files: [...values.files.filter((file) => file !== image), image] });
    setFilesError(undefined);
  }

  async function printNow() {
    if (values.files.length === 0) {
      setFilesError("Choose at least one image");
      return;
    }
    await ready();
    const what = values.files.length === 1 ? "image" : `${values.files.length} images`;
    const toast = await printingToast(`Printing ${what}…`);
    const result = await print({ receipt: receiptFor(values), source: "image" });
    if (!result.ok) {
      await showPrintResult(result, undefined, toast);
    } else if (result.missingImages.length) {
      toast.style = Toast.Style.Failure;
      toast.title = `Printed, but couldn't read ${names(result.missingImages)}`;
    } else {
      toast.hide();
      await showHUD(`Printed ${what}`);
      await popToRoot();
    }
  }

  return (
    <Form
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Print" icon={Icon.Print} onSubmit={printNow} />
          <Action.Push
            title="Preview"
            icon={Icon.Eye}
            shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
            target={<ReceiptPreviewDetail receipt={receiptFor(values)} navigationTitle="Image Preview" />}
          />
          <Action
            title="Add Image from Clipboard"
            icon={Icon.Clipboard}
            shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
            onAction={useClipboardImage}
          />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="files"
        title="Images"
        allowMultipleSelection
        canChooseDirectories={false}
        value={values.files}
        error={filesError}
        info="PNG, JPEG, HEIC, GIF, TIFF, WebP, or the first page of a PDF. Several images print one under another."
        onChange={(files) => {
          set({ files: files.filter(isImageFile) });
          setFilesError(undefined);
        }}
      />
      <Form.Dropdown
        id="size"
        title="Size"
        value={values.size}
        onChange={(size) => set({ size: size as Values["size"] })}
      >
        <Form.Dropdown.Item value="full" title="Full Width" />
        <Form.Dropdown.Item value="half" title="Half Width" />
        <Form.Dropdown.Item value="original" title="Original Size" />
      </Form.Dropdown>
      <Form.Dropdown
        id="look"
        title="Look"
        value={values.look}
        info="How grays become black dots. Photo suits pictures; Line Art suits logos, drawings and screenshots of text."
        onChange={(look) => set({ look: look as ImageLook })}
      >
        <Form.Dropdown.Item value="photo" title="Photo" />
        <Form.Dropdown.Item value="smooth" title="Smooth Gradients" />
        <Form.Dropdown.Item value="pattern" title="Halftone Pattern" />
        <Form.Dropdown.Item value="lineart" title="Line Art and Text" />
      </Form.Dropdown>
      <Form.Dropdown
        id="tone"
        title="Brightness"
        value={values.tone}
        onChange={(tone) => set({ tone: tone as ImageTone })}
      >
        <Form.Dropdown.Item value="darker" title="Darker" />
        <Form.Dropdown.Item value="normal" title="Normal" />
        <Form.Dropdown.Item value="lighter" title="Lighter" />
        <Form.Dropdown.Item value="lightest" title="Lightest" />
      </Form.Dropdown>
      <Form.Checkbox
        id="sideways"
        label="Turn wide images sideways to print them larger"
        value={values.sideways}
        onChange={(sideways) => set({ sideways })}
      />
      <Form.TextField
        id="caption"
        title="Caption"
        placeholder="Optional, printed under the image"
        value={values.caption}
        onChange={(caption) => set({ caption })}
      />
    </Form>
  );
}
