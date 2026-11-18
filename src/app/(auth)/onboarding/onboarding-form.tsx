"use client";

import { completeOnboarding } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Textarea } from "@/components/ui/form";

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
          <Field label="Your franchises' FD numbers" hint="Exactly as they appear on DPD documents, one per line or separated by commas. Add as many as you run." error={state.fieldErrors?.fdNumbers}>
            <Textarea name="fdNumbers" className="min-h-24 font-mono text-sm" autoCapitalize="characters" spellCheck={false} placeholder={"FD42102\nFD46578"} required />
          </Field>
          <div className="rounded-lg border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
            <p className="font-medium text-ink">Your DPD portal login</p>
            <p className="mt-0.5">This is how we read your payments and charges. It is stored encrypted, and the connection is read-only: it can look and download, never change anything in DPD.</p>
          </div>
          <Field label="DPD portal username" error={state.fieldErrors?.dpdUsername}>
            <Input name="dpdUsername" autoComplete="off" required />
          </Field>
          <Field label="DPD portal password" error={state.fieldErrors?.dpdPassword}>
            <Input name="dpdPassword" type="password" autoComplete="new-password" required />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Setting up…">Connect DPD and set up my dashboard</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
