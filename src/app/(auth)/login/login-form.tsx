"use client";

import { useState } from "react";
import { requestPasswordReset, signIn } from "@/lib/actions/auth";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "reset">("signin");

  if (mode === "reset") {
    return (
      <ActionForm action={requestPasswordReset} className="mt-6 space-y-4">
        {(state) => (
          <>
            <Field label="Email address" error={state.fieldErrors?.email}>
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Sending…">Email Me a Reset Link</SubmitButton>
            <button type="button" className="block w-full text-center text-sm text-accent underline-offset-2 hover:underline" onClick={() => setMode("signin")}>
              Back to Sign In
            </button>
          </>
        )}
      </ActionForm>
    );
  }

  return (
    <ActionForm action={signIn} className="mt-6 space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Field label="Email address" error={state.fieldErrors?.email}>
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Password" error={state.fieldErrors?.password}>
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Signing In…">Sign In</SubmitButton>
          <button type="button" className="block w-full text-center text-sm text-accent underline-offset-2 hover:underline" onClick={() => setMode("reset")}>
            Forgotten Your Password?
          </button>
        </>
      )}
    </ActionForm>
  );
}
