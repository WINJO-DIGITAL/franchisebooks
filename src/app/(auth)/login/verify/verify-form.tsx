"use client";

import { verifyMfaCode } from "@/lib/actions/mfa";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function VerifyForm({ next }: { next: string }) {
  return (
    <ActionForm action={verifyMfaCode} className="mt-6 space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="6-digit code" error={state.fieldErrors?.code}>
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required autoFocus />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Checking…">Continue</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
