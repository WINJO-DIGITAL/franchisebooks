"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/**
 * Picks a day for the daily view. The arrows and the date box only change what is chosen; the page keeps showing the day it
 * was on until Go is pressed. Inside a GET form named "date", so Go submits the chosen day.
 */
export function DayPicker({ date, max }: { date: string; max: string }) {
  const [value, setValue] = useState(date);
  const step = (days: number) => {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= max) setValue(next);
  };
  return (
    <>
      <button type="button" onClick={() => step(-1)} className={buttonClass("secondary", "sm")} aria-label="Earlier day"><ChevronLeft className="size-4" aria-hidden /></button>
      <label className="sr-only" htmlFor="earnings-date">Date</label>
      <input id="earnings-date" type="date" name="date" value={value} max={max} onChange={(e) => setValue(e.target.value)} className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-sm" />
      <button type="button" onClick={() => step(1)} disabled={value >= max} className={buttonClass("secondary", "sm")} aria-label="Later day"><ChevronRight className="size-4" aria-hidden /></button>
      <button type="submit" className={buttonClass("primary", "sm")}>Go</button>
    </>
  );
}
