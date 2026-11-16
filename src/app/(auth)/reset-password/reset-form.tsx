"use client";

import { updatePassword } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function ResetForm() {
  return (
    <ActionForm action={updatePassword} className="mt-6 space-y-4">
      {(state) => (
        <>
          <Field label="New password" error={state.fieldErrors?.password}>
            <Input name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Type it again" error={state.fieldErrors?.confirm}>
            <Input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full">Save new password</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
