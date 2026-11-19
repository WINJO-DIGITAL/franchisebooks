import type { Tone } from "@/components/ui/bits";

export const ADJUSTMENT_TYPES = [
  { value: "additional_payment", label: "Additional Payment", help: "Add money to the driver's pay.", sign: 1 },
  { value: "deduction", label: "Deduction", help: "Take money off the driver's pay.", sign: -1 },
  { value: "withheld_payment", label: "Withheld Payment", help: "Record a payment the driver should not receive. Enter £0 to record the decision without changing pay.", sign: -1 },
  { value: "cover_payment", label: "Cover Payment", help: "Pay for covering another driver's work.", sign: 1 },
  { value: "earnings_correction", label: "Earnings Correction", help: "Correct the pay up or down.", sign: 0 },
  { value: "other", label: "Other Adjustment", help: "Anything else, up or down.", sign: 0 },
] as const;

export type AdjustmentTypeValue = (typeof ADJUSTMENT_TYPES)[number]["value"];

export function adjustmentLabel(type: string): string {
  return ADJUSTMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}

export const ANOMALY_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: "New", tone: "warn" },
  investigating: { label: "Investigating", tone: "info" },
  resolved: { label: "Resolved", tone: "good" },
  expected: { label: "Expected Variation", tone: "neutral" },
  ignored: { label: "Ignored", tone: "neutral" },
};

export const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  urgent: { label: "Needs Attention Now", tone: "bad" },
  attention: { label: "Worth a Look", tone: "warn" },
  info: { label: "For Information", tone: "neutral" },
};

export const SOURCE_LABEL: Record<string, string> = {
  dpd_portal: "DPD portal",
  dropbox: "Dropbox",
  manual_upload: "Uploaded by hand",
  manual_entry: "Entered by hand",
  manual: "Entered by hand",
  document: "Imported document",
};

export const FILE_STATUS: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Received", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  imported: { label: "Imported", tone: "good" },
  needs_review: { label: "Needs Checking", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  ignored: { label: "Rejected", tone: "neutral" },
};

export const DOCUMENT_TYPE: Record<string, string> = {
  earnings_report: "Earnings report",
  fuel_report: "Fuel report",
  expense_report: "Expense report",
  unknown: "Not recognised",
};

export const FIGURE_STATUS: Record<string, { label: string; tone: Tone }> = {
  confirmed: { label: "Confirmed", tone: "good" },
  estimated: { label: "Estimated", tone: "warn" },
  unavailable: { label: "Not Available", tone: "neutral" },
};
