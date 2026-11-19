export type PortalErrorKind = "blocked" | "auth" | "layout" | "network" | "config";

/**
 * A failure while using the portal. `plainEnglish` is shown to the owner;
 * `step` and the message go to the technical details.
 */
export class PortalError extends Error {
  constructor(
    public readonly kind: PortalErrorKind,
    public readonly step: string,
    public readonly plainEnglish: string,
    technical?: string,
  ) {
    super(technical ?? plainEnglish);
    this.name = "PortalError";
  }

  /** Blocked and configuration problems will not fix themselves, so they are not retried. */
  get retryable(): boolean {
    return this.kind === "network" || this.kind === "layout";
  }
}

/** The step name used when the portal's Period drop-down has no period containing the date asked for. */
export const PERIOD_NOT_LISTED = "period-not-listed";
