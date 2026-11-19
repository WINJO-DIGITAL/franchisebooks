import { PortalError } from "./errors";

export const MFA_TEXT = /verification code|one[- ]time (pass)?code|authenticator app|two[- ]factor|2fa|security code|enter the code/i;
export const LOGIN_ERROR_TEXT = /incorrect|invalid|not recognised|not recognized|wrong (user|pass)|failed to (log|sign)/i;
/** DPD wants something done on the portal before it lets the login in, or the login is switched off. */
export const ACCOUNT_ACTION_TEXT = /password (has )?expired|(change|reset|update|set) (your |a new )?password|accept (the |our )?(new )?(terms|conditions)|terms (and|&) conditions|account (is |has been )?(locked|disabled|suspended|inactive|deactivated)|locked/i;

/**
 * Explains why a sign-in that was submitted did not end up signed in, from the text the portal showed. Plain English first, with
 * what the person should do; a short excerpt of what the page said goes in the technical details. Never bypasses anything.
 */
export function classifyLoginFailure(pageText: string, captchaShown: boolean): PortalError {
  const body = pageText.replace(/\s+/g, " ").trim();
  if (MFA_TEXT.test(body)) {
    return new PortalError("blocked", "login:mfa", "The DPD portal asked for a verification code. Automatic sign-in stops here on purpose: it will not try to get around two-step verification. Download the reports and upload them by hand, or use Dropbox.");
  }
  if (captchaShown) {
    return new PortalError("blocked", "login:captcha", "The DPD portal is asking for a CAPTCHA, which cannot (and will not) be completed automatically.");
  }
  if (ACCOUNT_ACTION_TEXT.test(body)) {
    return new PortalError(
      "blocked",
      "login:account-action",
      "DPD wants something done on the portal before it lets this login in, such as a password change or accepting new terms, or the login is locked. Sign in on the DPD portal yourself, sort that out, then press Check & refresh here.",
      `Portal said: ${body.slice(0, 200)}`,
    );
  }
  if (LOGIN_ERROR_TEXT.test(body)) {
    return new PortalError("auth", "login:rejected", "DPD did not accept this username and password. Check them in Settings, under DPD logins.");
  }
  return new PortalError(
    "layout",
    "login:confirm",
    "DPD did not confirm the sign-in. Try this username and password on the DPD portal yourself: if they do not work there, change them in Settings; if they do, the portal page may have changed and we will look at it.",
    `Signed-in marker not found after submitting the login form. Portal said: ${body.slice(0, 200)}`,
  );
}
