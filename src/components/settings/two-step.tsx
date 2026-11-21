"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { confirmMfaEnrollment, startMfaEnrollment, turnOffMfa } from "@/lib/actions/mfa";
import { ActionForm, ActionMessage, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import type { ActionState } from "@/lib/actions/helpers";

/** Turn two-step sign-in on (scan a code, confirm it) or off. `factorId` is the confirmed authenticator, when there is one. */
export function TwoStepPanel({ factorId }: { factorId: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [started, setStarted] = useState<ActionState | null>(null);

  if (factorId) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm"><Badge tone="good">On</Badge> Signing in needs your password and a code from your authenticator app.</p>
        <ActionForm action={turnOffMfa} onSuccess={() => router.refresh()}>
          <input type="hidden" name="factorId" value={factorId} />
          <SubmitButton variant="secondary" pendingLabel="Turning Off…">Turn Off Two-Step Sign-In</SubmitButton>
        </ActionForm>
      </div>
    );
  }

  if (setup) {
    return (
      <ActionForm action={confirmMfaEnrollment} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start" onSuccess={() => { setSetup(null); router.refresh(); }}>
        {(state) => (
          <>
            <input type="hidden" name="factorId" value={setup.factorId} />
            {/* The QR code is an image from the sign-in service, shown only while setting up. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="QR code for your authenticator app" className="size-44 rounded-lg border border-line bg-white p-2" />
            <div className="space-y-3">
              <p className="text-sm text-ink-soft">Scan the code with an authenticator app (such as Google Authenticator, Microsoft Authenticator or 1Password). On a phone, type this key into the app instead: <span className="break-all font-mono text-xs">{setup.secret}</span></p>
              <Field label="6-digit code" error={state.fieldErrors?.code}>
                <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required />
              </Field>
              <SubmitButton pendingLabel="Checking…">Confirm and Turn On</SubmitButton>
            </div>
          </>
        )}
      </ActionForm>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">Add a code from an authenticator app to the password. If someone learns your password, they still cannot sign in without your phone.</p>
      <Button
        type="button"
        disabled={pending}
        onClick={() => start(async () => {
          const result = await startMfaEnrollment();
          setStarted(result);
          if (result.ok && result.data) setSetup({ factorId: String(result.data.factorId), qr: String(result.data.qr), secret: String(result.data.secret) });
        })}
      >
        {pending ? "Starting…" : "Turn On Two-Step Sign-In"}
      </Button>
      {started && !started.ok ? <ActionMessage state={started} /> : null}
    </div>
  );
}
