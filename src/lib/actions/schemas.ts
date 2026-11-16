import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { parseMoney } from "@/lib/money";

export const uuid = z.uuid("Please choose one of the options.");
export const optionalUuid = z.union([z.literal(""), z.uuid()]).optional().transform((v) => (v ? v : null));
export const isoDate = z.string().refine(isISODate, "Choose a date.");
export const optionalIsoDate = z.string().optional().transform((v) => (v ? v : null)).refine((v) => v === null || isISODate(v), "That is not a valid date.");
export const optionalText = (max = 500) => z.string().max(max, `Keep this under ${max} characters.`).optional().transform((v) => (v ? v : null));

/** A positive money amount typed by the owner ("50", "£50.00", "1,250.50") → pence. */
export const moneyAmount = z
  .string()
  .min(1, "Enter an amount.")
  .transform((value, ctx) => {
    const pence = parseMoney(value);
    if (pence == null || pence < 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in pounds and pence, for example 50 or 50.00." });
      return z.NEVER;
    }
    if (pence > 10_000_000) {
      ctx.addIssue({ code: "custom", message: "That amount looks too large. Please check it." });
      return z.NEVER;
    }
    return pence;
  });

export const registration = z
  .string()
  .max(12)
  .optional()
  .transform((v) => (v ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : null))
  .transform((v) => (v === "" ? null : v));
