/**
 * Next.js instrumentation hook. Every uncaught server error (page, route
 * handler, server action) is passed through reportError, which redacts
 * secrets, writes a structured log line and, if ERROR_WEBHOOK_URL is set,
 * forwards it to the error tracker.
 */

import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // The logger uses Node APIs (pino, process.env lookups), so skip the Edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/logger");
  await reportError(error, {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    digest: (error as { digest?: string }).digest,
  });
};
