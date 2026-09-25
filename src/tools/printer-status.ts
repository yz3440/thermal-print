import { blockingReason } from "../core/escpos";
import { specFor } from "../core/models";
import { asPrinterError } from "../core/print";
import { MODEL_HINT } from "../ui/feedback";
import { printerSettings } from "../ui/settings";
import { checkPrinter } from "../ui/status";

/** Checks whether the receipt printer is reachable and ready to print, without printing anything. */
export default async function printerStatus() {
  const settings = printerSettings();
  try {
    const check = await checkPrinter(settings.address, settings.model);
    const status = check.probe.status;
    const problem = status ? blockingReason(status) : undefined;
    return {
      reachable: true,
      ready: !problem,
      problem,
      address: check.address,
      model: specFor(check.model).name,
      modelSource: check.modelSource,
      hint: check.detected ? undefined : MODEL_HINT,
      /** False for printers that don't answer status queries; they still print. */
      reportsStatus: !!status,
      online: status?.online,
      coverOpen: status?.coverOpen,
      paperOut: status?.paperOut,
      paperLow: status?.paperNearEnd,
      firmware: check.probe.identity?.firmware,
      answeredInMs: check.probe.connectMs,
    };
  } catch (caught) {
    const error = asPrinterError(caught);
    return {
      reachable: false,
      ready: false,
      problem: error.message,
      hint: error.hint,
      address: settings.address.trim() || undefined,
    };
  }
}
