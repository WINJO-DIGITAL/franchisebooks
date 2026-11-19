"use client";

import { useRef, useState } from "react";
import { completeOnboarding } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { MAX_DPD_LOGINS } from "@/lib/onboarding/dpd-logins-form";

export function OnboardingForm() {
  const nextId = useRef(1);
  const [blocks, setBlocks] = useState<number[]>([0]);

  return (
    <ActionForm action={completeOnboarding} className="mt-6 space-y-4">
      {(state) => (
        <>
          <Field label="What is your business called?" error={state.fieldErrors?.businessName}>
            <Input name="businessName" autoComplete="organization" autoCapitalize="words" required />
          </Field>
          <Field label="What is your name?" error={state.fieldErrors?.fullName}>
            <Input name="fullName" autoComplete="name" autoCapitalize="words" required />
          </Field>

          {blocks.map((id, position) => (
            <div key={id} className="space-y-4 rounded-lg border border-line bg-sunken px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm text-ink-soft">
                  <p className="font-medium text-ink">{position === 0 ? "Your DPD portal login" : `DPD portal login ${position + 1}`}</p>
                  <p className="mt-0.5">
                    This is how we read your payments and charges. It is stored encrypted, and the connection is read-only: it can look and download, never change anything in DPD.
                  </p>
                </div>
                {blocks.length > 1 ? (
                  <button type="button" className="shrink-0 text-sm text-ink-soft underline" onClick={() => setBlocks((b) => b.filter((x) => x !== id))}>
                    Remove
                  </button>
                ) : null}
              </div>

              <Field label="DPD portal username" error={state.fieldErrors?.[`dpdUsername_${id}`]}>
                <Input name={`dpdUsername_${id}`} autoComplete="off" required />
              </Field>
              <Field label="DPD portal password" error={state.fieldErrors?.[`dpdPassword_${id}`]}>
                <Input name={`dpdPassword_${id}`} type="password" autoComplete="new-password" required />
              </Field>
              <Field label="Name for this login (optional)" hint="Leave blank to use the username." error={state.fieldErrors?.[`dpdLabel_${id}`]}>
                <Input name={`dpdLabel_${id}`} autoComplete="off" />
              </Field>
              <Field
                label="FD numbers on this login (optional)"
                hint="Exactly as they appear on DPD documents, separated by commas or new lines. Leave blank and we'll read them from DPD."
                error={state.fieldErrors?.[`dpdFds_${id}`]}
              >
                <Input name={`dpdFds_${id}`} className="font-mono text-sm" autoCapitalize="characters" spellCheck={false} placeholder="FD42102, FD46578" />
              </Field>
            </div>
          ))}

          {blocks.length < MAX_DPD_LOGINS ? (
            <button
              type="button"
              className="w-full rounded-lg border border-line px-4 py-2.5 text-sm text-ink hover:bg-sunken"
              onClick={() => setBlocks((b) => [...b, nextId.current++])}
            >
              + Add Another DPD Login
            </button>
          ) : null}

          <SubmitButton className="w-full" pendingLabel="Setting Up…">Connect DPD and Set Up My Dashboard</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
