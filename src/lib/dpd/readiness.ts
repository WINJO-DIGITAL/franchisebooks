/**
 * Whether an account is ready for automatic DPD sync.
 *
 * The portal setup is shared, so the only thing an account must supply is its own DPD login.
 * Saving the login records `loginSavedAt` on the account's DPD connection, which is cheap to check
 * (no decryption) and so safe to use for every account on every scheduler tick.
 */

export interface DpdConnectionConfig {
  portalMap?: unknown;
  loginSavedAt?: string;
}

export function dpdSetupReady(config: unknown): boolean {
  return typeof (config as DpdConnectionConfig | null)?.loginSavedAt === "string";
}

/** An account's own portal map override, if it has one. */
export function ownPortalMap(config: unknown): unknown {
  return (config as DpdConnectionConfig | null)?.portalMap ?? null;
}
