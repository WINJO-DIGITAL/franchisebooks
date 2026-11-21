/**
 * Expiry dates for drivers and vehicles. Pure code: the reminder is a plain comparison of a date the owner entered with today,
 * so there is no estimate and nothing here changes pay or any DPD figure.
 */

import { daysBetween, type ISODate } from "@/lib/dates";

/** A date within this many days of today is shown as due soon. */
export const DUE_SOON_DAYS = 30;

export const DRIVER_KINDS = ["driver_licence", "right_to_work", "dbs", "driver_other"] as const;
export const VEHICLE_KINDS = ["mot", "service", "road_tax", "vehicle_insurance", "vehicle_other"] as const;
export type ComplianceKind = (typeof DRIVER_KINDS)[number] | (typeof VEHICLE_KINDS)[number];

export const KIND_LABEL: Record<ComplianceKind, string> = {
  driver_licence: "Driving Licence",
  right_to_work: "Right to Work",
  dbs: "DBS Check",
  driver_other: "Other",
  mot: "MOT",
  service: "Service",
  road_tax: "Road Tax",
  vehicle_insurance: "Insurance",
  vehicle_other: "Other",
};

export type DateStatus = "overdue" | "due_soon" | "current";

export interface DateReminder {
  status: DateStatus;
  /** Days until the date: negative when it has passed. */
  days: number;
}

export function reminderFor(expiresOn: ISODate, today: ISODate): DateReminder {
  const days = daysBetween(today, expiresOn);
  if (days < 0) return { status: "overdue", days };
  if (days <= DUE_SOON_DAYS) return { status: "due_soon", days };
  return { status: "current", days };
}

/** Plain words for a reminder, for example "Overdue by 3 days" or "Due in 12 days". */
export function reminderText(reminder: DateReminder): string {
  const n = Math.abs(reminder.days);
  const unit = n === 1 ? "day" : "days";
  if (reminder.status === "overdue") return n === 0 ? "Due today" : `Overdue by ${n} ${unit}`;
  if (reminder.days === 0) return "Due today";
  if (reminder.status === "due_soon") return `Due in ${n} ${unit}`;
  return `In ${n} ${unit}`;
}
