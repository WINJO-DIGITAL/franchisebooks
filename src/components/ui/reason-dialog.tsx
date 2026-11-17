"use client";

import { useState, type ReactNode } from "react";
import type { ActionState } from "@/lib/actions/helpers";
import { ActionForm, SubmitButton } from "./action-form";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field, Textarea } from "./form";

/** A button that opens a small confirmation dialog asking for a reason before running an action. */
export function ReasonDialog({
  action, fields, trigger, title, explanation, reasonLabel = "Reason", submitLabel, variant = "quiet",
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  trigger: string;
  title: string;
  explanation?: ReactNode;
  reasonLabel?: string;
  submitLabel: string;
  variant?: "quiet" | "secondary" | "danger";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size="sm" onClick={() => setOpen(true)}>{trigger}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <ActionForm action={action} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
              {explanation ? <div className="text-[0.9375rem] text-ink-soft">{explanation}</div> : null}
              <Field label={reasonLabel} error={state.fieldErrors?.reason}>
                <Textarea name="reason" required maxLength={500} />
              </Field>
              <SubmitButton>{submitLabel}</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}
