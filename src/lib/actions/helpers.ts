import "server-only";
import type { z } from "zod";
import { MissingConfigError } from "@/lib/env";
import { describeError, logger } from "@/lib/logger";

/** What every server action returns to its form. Messages are always plain English. */
export interface ActionState {
  ok: boolean;
  message: string;
  /** Technical detail, shown only inside an expandable section. */
  detail?: string | null;
  fieldErrors?: Record<string, string>;
  /** Optional payload for the client (e.g. the id of the row just created). */
  data?: Record<string, string | number | null>;
}

export const idle: ActionState = { ok: false, message: "" };

export function ok(message: string, data?: ActionState["data"]): ActionState {
  return { ok: true, message, data };
}

export function fail(message: string, detail?: string | null, fieldErrors?: Record<string, string>): ActionState {
  return { ok: false, message, detail: detail ?? null, fieldErrors };
}

/** Codes our own database functions raise with messages written for the owner. */
const PLAIN_ENGLISH_CODES = new Set(["P0001", "P0002"]);

interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Turns a database error into a plain-English message plus technical detail. */
export function dbFailure(error: DbError, fallback = "That could not be saved. Nothing was changed."): ActionState {
  const detail = [error.code, error.message, error.details, error.hint].filter(Boolean).join(" · ");
  if (error.code && PLAIN_ENGLISH_CODES.has(error.code)) return fail(error.message, detail);
  if (error.code === "42501") return fail("You do not have permission to do that.", detail);
  if (error.code === "23505") return fail("That already exists, so it was not added again.", detail);
  if (error.code === "23503") return fail("That refers to something that no longer exists, or is still in use.", detail);
  if (error.code === "23514") return fail("One of the values is not allowed. Please check the form and try again.", detail);
  if (/row-level security/i.test(error.message)) return fail("You do not have permission to do that.", detail);
  logger.warn({ err: error }, "Unmapped database error");
  return fail(fallback, detail);
}

export function unexpectedFailure(error: unknown, fallback = "Something went wrong. Nothing was changed."): ActionState {
  if (error instanceof MissingConfigError) return fail(error.plainEnglish, `Missing environment variable ${error.variable}`);
  const detail = describeError(error);
  logger.error({ err: detail }, "Action failed");
  return fail(fallback, `${detail.name}: ${detail.message}`);
}

/** Validates form data against a Zod schema, returning per-field messages on failure. */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): { data: z.infer<S> } | { error: ActionState } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") raw[key] = value.trim();
  }
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { error: fail("Please check the highlighted answers.", null, fieldErrors) };
}
