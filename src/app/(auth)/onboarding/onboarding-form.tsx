"use client";

import { completeOnboarding } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function OnboardingForm() {
  return (
    <ActionForm action={completeOnboarding} className="mt-6 space-y-4">
      {(state) => (
        <>
          <Field label="What is your business called?" error={state.fieldErrors?.businessName}>
            <Input name="businessName" autoComplete="organization" required />
          </Field>
          <Field label="What is your name?" error={state.fieldErrors?.fullName}>
            <Input name="fullName" autoComplete="name" required />
          </Field>
          <Field label="Your first franchise FD number" hint="Exactly as it appears on DPD documents. Leave blank to add franchises later." error={state.fieldErrors?.fdNumber}>
            <Input name="fdNumber" autoCapitalize="characters" />
          </Field>
          <Field label="A name for that franchise (optional)" hint="For example the depot or area.">
            <Input name="franchiseName" />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Setting up…">Start using Franchise Manager</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
