"use client";

import { useRouter } from "next/navigation";
import { emailDriverStatement, makeDriverStatements } from "@/lib/actions/statements";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";

/** Makes (or makes again) the driver statements for the chosen pay period. */
export function MakeStatementsForm({ periodStart, franchiseId, label }: { periodStart: string; franchiseId: string | null; label: string }) {
  const router = useRouter();
  return (
    <ActionForm action={makeDriverStatements} className="space-y-3" onSuccess={() => router.refresh()}>
      {() => (
        <>
          <input type="hidden" name="periodStart" value={periodStart} />
          <input type="hidden" name="franchiseId" value={franchiseId ?? ""} />
          <SubmitButton variant="secondary" pendingLabel="Making…">{label}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

/** Emails one statement to its driver. Off unless the owner presses it. */
export function EmailStatementButton({ id, emailedAt }: { id: string; emailedAt: string | null }) {
  const router = useRouter();
  return (
    <ActionForm action={emailDriverStatement} className="inline-block" onSuccess={() => router.refresh()}>
      {() => (
        <>
          <input type="hidden" name="id" value={id} />
          <SubmitButton variant="quiet" size="sm" pendingLabel="Sending…">{emailedAt ? "Email again" : "Email to driver"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
