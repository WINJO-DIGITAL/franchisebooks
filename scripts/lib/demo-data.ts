/**
 * Synthetic demo data. Every name, number plate and figure is invented.
 * Generation is deterministic (seeded), so two runs produce the same story.
 */

import { createHash } from "node:crypto";

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export const DEMO_FRANCHISES = [
  { fd: "FD-DEMO1", name: "Demo North", depot: "Demo Depot A" },
  { fd: "FD-DEMO2", name: "Demo South", depot: "Demo Depot B" },
];

export interface DemoDriver {
  name: string;
  ref: string;
  franchise: 0 | 1;
  route: string;
  reg: string;
  parcelsBase: number;
  stopsRatio: number;
}

export const DEMO_DRIVERS: DemoDriver[] = [
  { name: "Alex Example", ref: "D1001", franchise: 0, route: "N01", reg: "AB21DEM", parcelsBase: 140, stopsRatio: 0.76 },
  { name: "Blake Sample", ref: "D1002", franchise: 0, route: "N02", reg: "AB22DEM", parcelsBase: 128, stopsRatio: 0.75 },
  { name: "Casey Testcase", ref: "D1003", franchise: 0, route: "N03", reg: "AB23DEM", parcelsBase: 152, stopsRatio: 0.77 },
  { name: "Devon Placeholder", ref: "D1004", franchise: 1, route: "S01", reg: "CD21DEM", parcelsBase: 118, stopsRatio: 0.74 },
  { name: "Emery Specimen", ref: "D1005", franchise: 1, route: "S02", reg: "CD22DEM", parcelsBase: 134, stopsRatio: 0.76 },
  { name: "Frankie Mockup", ref: "D1006", franchise: 1, route: "S03", reg: "CD23DEM", parcelsBase: 146, stopsRatio: 0.78 },
];

export const PAY_PER_PARCEL = 0.45;
export const PAY_PER_STOP = 0.85;

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DemoEarning {
  driver: DemoDriver;
  date: string;
  parcels: number;
  stops: number;
  gross: number;
  deductions: number;
  additional: number;
  net: number;
}

/** Weekday earnings for each driver across the given dates. */
export function generateEarnings(dates: string[], isWeekday: (d: string) => boolean): DemoEarning[] {
  const out: DemoEarning[] = [];
  const rand = seeded(20261116);
  for (const date of dates) {
    if (!isWeekday(date)) continue;
    for (const driver of DEMO_DRIVERS) {
      const parcels = Math.round(driver.parcelsBase * (0.85 + rand() * 0.3));
      const stops = Math.round(parcels * driver.stopsRatio);
      const gross = round2(parcels * PAY_PER_PARCEL + stops * PAY_PER_STOP);
      const deductions = rand() < 0.08 ? round2(5 + rand() * 15) : 0;
      const additional = rand() < 0.06 ? round2(10 + rand() * 20) : 0;
      out.push({ driver, date, parcels, stops, gross, deductions, additional, net: round2(gross - deductions + additional) });
    }
  }
  return out;
}

export interface DemoFuel {
  date: string;
  reg: string;
  litres: number;
  pricePerLitre: number;
  total: number;
  ref: string;
  franchise: 0 | 1;
}

export function generateFuel(dates: string[], isWeekday: (d: string) => boolean): DemoFuel[] {
  const rand = seeded(777);
  const out: DemoFuel[] = [];
  for (const date of dates) {
    if (!isWeekday(date)) continue;
    for (const driver of DEMO_DRIVERS) {
      if (rand() > 0.35) continue;
      const litres = round2(35 + rand() * 25);
      const pricePerLitre = round2(1.38 + rand() * 0.12);
      out.push({ date, reg: driver.reg, litres, pricePerLitre, total: round2(litres * pricePerLitre), ref: `DEMO-F-${date}-${driver.ref}`, franchise: driver.franchise });
    }
  }
  return out;
}

export const DEMO_EXPENSES = [
  { category: "Vehicle maintenance", description: "Service — demo van", amount: 184.5, offset: 5, franchise: 0 as const },
  { category: "Tyres", description: "Two front tyres — demo van", amount: 212.0, offset: 12, franchise: 1 as const },
  { category: "Parking", description: "Depot parking permit", amount: 45.0, offset: 18, franchise: 0 as const },
  { category: "Equipment", description: "Handheld scanner holder", amount: 29.99, offset: 20, franchise: 1 as const },
];

export function fakeSha256(label: string): string {
  return createHash("sha256").update(`demo-seed:${label}`).digest("hex");
}
