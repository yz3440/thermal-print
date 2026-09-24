import { LaunchProps } from "@raycast/api";
import { ComposeForm, type ComposeValues } from "./ui/ComposeForm";

export default function ComposeReceipt(
  props: LaunchProps<{ draftValues: ComposeValues; launchContext: Partial<ComposeValues> }>,
) {
  return <ComposeForm enableDrafts initial={props.launchContext ?? props.draftValues} />;
}
