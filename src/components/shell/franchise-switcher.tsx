"use client";

import { useState, useTransition } from "react";
import { selectFranchise } from "@/lib/actions/auth";

/**
 * The franchise picker. "All franchises" is offered whenever the business has more than one franchise, even if only one is
 * switched on, so the picker always says what the page shows (switched-off franchises are left out of "All franchises").
 *
 * The picker shows the choice you just made straight away, and is locked until that choice has been saved. Without this, a
 * slow reply to an earlier choice could arrive after a later one and put the earlier franchise back on screen.
 */
export function FranchiseSwitcher({ franchises, selected, showAll }: { franchises: { id: string; label: string }[]; selected: string | null; showAll?: boolean }) {
  const [value, setValue] = useState(selected ?? "all");
  const [saving, startSaving] = useTransition();
  if (franchises.length === 0) return null;

  const choose = (next: string) => {
    setValue(next);
    const data = new FormData();
    data.set("franchise", next);
    startSaving(async () => {
      await selectFranchise(data);
    });
  };

  return (
    <div className="min-w-0 flex-1 sm:flex-none">
      <label className="sr-only" htmlFor="franchise-switcher">Franchise</label>
      <select
        id="franchise-switcher"
        name="franchise"
        value={value}
        disabled={saving}
        onChange={(e) => choose(e.target.value)}
        className="h-10 w-full min-w-0 truncate rounded-lg border border-line-strong bg-surface pl-3 pr-8 text-sm font-medium text-ink focus:border-accent focus:outline-none disabled:opacity-70 sm:w-auto sm:max-w-xs"
      >
        {showAll ?? franchises.length > 1 ? <option value="all">All franchises</option> : null}
        {franchises.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
    </div>
  );
}
