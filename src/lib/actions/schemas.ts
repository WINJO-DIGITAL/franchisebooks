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

/** An optional money amount typed by the owner. Empty means "not set" (null); otherwise pence. */
export const optionalMoneyAmount = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const text = (value ?? "").trim();
    if (text === "") return null;
    const pence = parseMoney(text);
    if (pence == null || pence < 0) {
      ctx.addIssue({ code: "custom", message: "Enter an amount in pounds and pence, for example 1 or 1.50." });
      return z.NEVER;
    }
    return pence;
  });

/** An optional whole number between `min` and `max`. Empty means "not set" (null). */
export const optionalWholeNumber = (min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      const text = (value ?? "").trim();
      if (text === "") return null;
      const n = Number(text);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Enter a whole number from ${min} to ${max}.` });
        return z.NEVER;
      }
      return n;
    });
