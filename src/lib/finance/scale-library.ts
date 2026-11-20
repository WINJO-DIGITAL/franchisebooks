import "server-only";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ScaleGrid } from "./scale-grid";

/**
 * The DPD sliding scales saved in data/sliding-scales, one JSON file per scale as the DPD portal lists it.
 *
 * A scale's key is its file name without ".json". A key is only ever accepted if it is in the saved list, so nothing a
 * user sends can reach a different file. The list is read once and kept; the grids are read on demand.
 */

const DIR = path.join(process.cwd(), "data", "sliding-scales");

export interface ScaleSummary {
  key: string;
  /** The exact name the DPD portal shows, as the owner confirmed it. */
  name: string;
  /** ODF or ODW. */
  scheme: string;
  /** The effective date the DPD portal shows, as YYYY-MM-DD. */
  effectiveDate: string;
  /** Position in the DPD portal's own list, so the dropdown reads the way DPD's does. */
  order: number;
}

export interface ScaleFile {
  name: string;
  printed_title?: string;
  scheme?: string;
  effective_date?: string;
  display_order?: number;
  stopRows: number[];
  mileCols: number[];
  values: number[][];
}

export const SCALE_KEY_FORMAT = /^[a-z0-9][a-z0-9-]{0,79}$/;

let summaries: Promise<ScaleSummary[]> | null = null;

async function readSummaries(): Promise<ScaleSummary[]> {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json")).sort();
  const out: ScaleSummary[] = [];
  for (const f of files) {
    const key = f.slice(0, -".json".length);
    if (!SCALE_KEY_FORMAT.test(key)) continue;
    const d = JSON.parse(await readFile(path.join(DIR, f), "utf8")) as ScaleFile;
    out.push({ key, name: d.name, scheme: d.scheme ?? "", effectiveDate: d.effective_date ?? "", order: d.display_order ?? Number.MAX_SAFE_INTEGER });
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "en-GB"));
}

/** Every saved scale, in the order the DPD portal lists them. */
export function listScales(): Promise<ScaleSummary[]> {
  summaries ??= readSummaries().catch((e) => { summaries = null; throw e; });
  return summaries;
}

/** True when the key names a saved scale. */
export async function isScaleKey(key: string | null | undefined): Promise<boolean> {
  if (!key || !SCALE_KEY_FORMAT.test(key)) return false;
  return (await listScales()).some((s) => s.key === key);
}

/** The scale's summary, or null for an unknown key. */
export async function scaleSummary(key: string | null | undefined): Promise<ScaleSummary | null> {
  if (!key) return null;
  return (await listScales()).find((s) => s.key === key) ?? null;
}

/** The scale's grid for the report, or null for an unknown key. */
export async function loadScaleGrid(key: string | null | undefined): Promise<ScaleGrid | null> {
  if (!(await isScaleKey(key))) return null;
  const d = JSON.parse(await readFile(path.join(DIR, `${key}.json`), "utf8")) as ScaleFile;
  return { name: d.name, stopRows: d.stopRows, mileCols: d.mileCols, values: d.values };
}
