"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from "react";
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

const PendingContext = createContext<boolean | null>(null);

export function SubmitButton({ children, pendingLabel, ...props }: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const status = useFormStatus();
  const fromForm = useContext(PendingContext);
  const pending = fromForm ?? status.pending;
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
  const [state, formAction, pending] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
  }, [state, resetOnSuccess, onSuccess]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  }

  return (
    // Submitted by hand rather than through the form's `action` prop: React resets an
    // `action` form after every submit, which wipes what the person typed when something
    // needs correcting (and can race with them typing the correction).
    <form ref={ref} onSubmit={onSubmit} className={className} noValidate>
      <PendingContext.Provider value={pending}>
        {typeof children === "function" ? children(state) : children}
        {state.message ? <div className="mt-4"><ActionMessage state={state} /></div> : null}
      </PendingContext.Provider>
    </form>
  );
}
