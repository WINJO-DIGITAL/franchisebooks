"use client";

import { useState } from "react";

export interface DailyPoint {
  date: string;
  label: string;
  value: number;
  valueLabel: string;
  hasData: boolean;
}

/**
 * Daily column chart (single measure, single hue). Hover or focus a column to
 * read its exact figure; the same figures are available as a table for screen
 * readers.
 */
export function DailyColumns({ points, caption }: { points: DailyPoint[]; caption: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const shown = active != null ? points[active] : null;

  return (
    <figure>
      <div className="mb-2 flex h-6 items-baseline justify-between text-sm">
        <figcaption className="text-muted">{caption}</figcaption>
        <p className="num font-medium text-ink" aria-live="polite">
          {shown ? `${shown.label}: ${shown.hasData ? shown.valueLabel : "no report"}` : ""}
        </p>
      </div>
      <div className="flex h-28 items-end gap-[2px] border-b border-line-strong" role="img" aria-label={caption} onMouseLeave={() => setActive(null)}>
        {points.map((point, index) => (
          <button
            key={point.date}
            type="button"
            className="group relative flex h-full flex-1 items-end focus:outline-none"
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            aria-label={`${point.label}: ${point.hasData ? point.valueLabel : "no report"}`}
          >
            <span
              className={`block w-full rounded-t-[4px] ${point.hasData ? (active === index ? "bg-accent-strong" : "bg-accent-bar") : "bg-line"} group-focus-visible:ring-2 group-focus-visible:ring-accent`}
              style={{ height: point.hasData ? `${Math.max(3, (point.value / max) * 100)}%` : "3px" }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.date}>
              <th scope="row">{p.label}</th>
              <td>{p.hasData ? p.valueLabel : "No report"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
