import type { Json } from "./database.types";

/** A JSON object value for a non-null jsonb column. */
export type JsonObject = { [key: string]: Json | undefined };

export function toJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value ?? {})) as JsonObject;
}
