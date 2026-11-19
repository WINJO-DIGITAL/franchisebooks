"use client";

import { useActionState, useState } from "react";
import { setAlertStatus } from "@/lib/actions/alerts";
import type { ActionState } from "@/lib/actions/helpers";
import { Button } from "@/components/ui/button";

const initial: ActionState = { ok: false, message: "" };
const CHOICES = [
  { value: "investigating", label: "Investigating" },
  { value: "resolved", label: "Resolved" },
  { value: "expected", label: "Expected Variation" },
  { value: "ignored", label: "Ignore" },
] as const;

/** One-tap decision buttons for an alert. Marking an alert never changes any financial figure. */
export function AlertStatusForm({ id, current }: { id: string; current: string }) {
  const [state, action, pending] = useActionState(setAlertStatus, initial);
  const [note, setNote] = useState("");
  return (
    <form action={action} className="mt-4 border-t border-line pt-3">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`note-${id}`}>Note (optional)</label>
      <input id={`note-${id}`} name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Add a note (optional)"
        className="mb-2 h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm sm:max-w-md" />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Mark as:</span>
        {CHOICES.map((choice) => (
          <Button key={choice.value} type="submit" name="status" value={choice.value} size="sm" variant={current === choice.value ? "primary" : "secondary"} disabled={pending}>
            {choice.label}
          </Button>
        ))}
        {current !== "open" ? <Button type="submit" name="status" value="open" size="sm" variant="quiet" disabled={pending}>Reopen</Button> : null}
      </div>
      {state.message ? <p className={`mt-2 text-sm ${state.ok ? "text-good" : "text-bad"}`} role="status">{state.message}</p> : null}
    </form>
  );
}
