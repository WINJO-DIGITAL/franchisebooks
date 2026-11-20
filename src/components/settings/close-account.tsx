"use client";

import { requestAccountClosure } from "@/lib/actions/account";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function CloseAccountForm() {
  return (
    <ActionForm action={requestAccountClosure} className="max-w-md space-y-3">
      {(state) => (
        <>
          <p className="text-sm text-ink-soft">This removes every DPD login and its stored password straight away, so the app stops reading DPD. Financial records are kept for the period our terms set out. Your subscription is cancelled too: it runs to the end of the month you have paid for, then stops.</p>
          <Field label="Type CLOSE to confirm" error={state.fieldErrors?.confirm}>
            <Input name="confirm" autoComplete="off" required />
          </Field>
          <SubmitButton variant="danger" pendingLabel="Closing…">Close This Account</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
