"use client";

import { useRef } from "react";
import { selectFranchise } from "@/lib/actions/auth";

export function FranchiseSwitcher({ franchises, selected }: { franchises: { id: string; label: string }[]; selected: string | null }) {
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
        {franchises.length > 1 ? <option value="all">All franchises</option> : null}
        {franchises.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
    </form>
  );
}
