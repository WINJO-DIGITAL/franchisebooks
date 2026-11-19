"use client";

import { useRef } from "react";
import { selectFranchise } from "@/lib/actions/auth";

/**
 * The franchise picker. "All franchises" is offered whenever the business has more than one franchise, even if only one is
 * switched on, so the picker always says what the page shows (switched-off franchises are left out of "All franchises").
 */
export function FranchiseSwitcher({ franchises, selected, showAll }: { franchises: { id: string; label: string }[]; selected: string | null; showAll?: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  if (franchises.length === 0) return null;
  return (
    <form ref={form} action={selectFranchise} className="min-w-0 flex-1 sm:flex-none">
      <label className="sr-only" htmlFor="franchise-switcher">Franchise</label>
      <select
        id="franchise-switcher"
        name="franchise"
        defaultValue={selected ?? "all"}
        onChange={() => form.current?.requestSubmit()}
        className="h-10 w-full min-w-0 truncate rounded-lg border border-line-strong bg-surface pl-3 pr-8 text-sm font-medium text-ink focus:border-accent focus:outline-none sm:w-auto sm:max-w-xs"
      >
        {showAll ?? franchises.length > 1 ? <option value="all">All franchises</option> : null}
        {franchises.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
    </form>
  );
}
