"use client";

import { ErrorView } from "@/components/errors/error-view";

/** Shown inside the signed-in shell, so the menu stays available. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView error={error} reset={reset} />;
}
