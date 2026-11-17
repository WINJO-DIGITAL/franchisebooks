"use client";

import { useActionState, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions/helpers";
import { Notice } from "./bits";
import { Button } from "./button";

const initial: ActionState = { ok: false, message: "" };

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** Shows the outcome of a server action in plain English, with technical details tucked away. */
export function ActionMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <Notice tone={state.ok ? "good" : "bad"} title={state.message} detail={state.ok ? null : state.detail} />
  );
}

export function SubmitButton({ children, pendingLabel, ...props }: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (pendingLabel ?? "Saving…") : children}
    </Button>
  );
}

/**
 * A form wired to a server action. `children` receives the latest action
 * state so fields can show their own error messages.
 */
export function ActionForm({
  action, children, className, resetOnSuccess, onSuccess,
}: {
  action: Action;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const submitted = useRef<FormData | null>(null);
  const [state, formAction] = useActionState(async (prev: ActionState, data: FormData) => {
    submitted.current = data;
    return action(prev, data);
  }, initial);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

  // React clears an uncontrolled form after every submit. When something needs correcting
  // the person should not have to type it all again, so put back what they entered.
  // A layout effect runs straight after React's own reset, before anything is painted or typed.
  useLayoutEffect(() => {
    if (state.ok || !state.message || !submitted.current || !ref.current) return;
    const data = submitted.current;
    const form = ref.current;
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) || !element.name) continue;
      if (element instanceof HTMLInputElement) {
        if (element.type === "password" || element.type === "file" || element.type === "submit" || element.type === "hidden") continue;
        if (element.type === "radio" || element.type === "checkbox") {
          element.checked = data.getAll(element.name).includes(element.value);
          continue;
        }
      }
      const value = data.get(element.name);
      if (typeof value === "string" && element.value !== value) element.value = value;
    }
  }, [state]);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  return (
    <form ref={ref} action={formAction} className={className} noValidate>
      {typeof children === "function" ? children(state) : children}
      {state.message ? <div className="mt-4"><ActionMessage state={state} /></div> : null}
    </form>
  );
}
