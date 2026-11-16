"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
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
  const [state, formAction] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

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
