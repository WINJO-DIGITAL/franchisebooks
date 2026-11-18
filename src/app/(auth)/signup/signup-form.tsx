"use client";

import { signUp } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function SignUpForm() {
  return (
    <ActionForm action={signUp} className="mt-6 space-y-4">
      {(state) => (
        <>
          <Field label="Email address" error={state.fieldErrors?.email}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Choose a password" hint="At least 10 characters." error={state.fieldErrors?.password}>
            <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
          </Field>
          <Field label="Type it again" error={state.fieldErrors?.confirm}>
            <Input name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Creating your account…">Continue</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
