/**
 * Read-only guard for the DPD portal.
 *
 * The integration must never change anything in the portal. This is enforced
 * at two independent levels:
 *
 *   1. NETWORK — every request is intercepted. Only GET/HEAD/OPTIONS are let
 *      through. The single exception is the sign-in POST, allowed only during
 *      the login phase and only to the login URL(s); plus any POST endpoints
 *      the reviewed portal map explicitly lists as read-only queries.
 *   2. INTERACTION — clicks go through `safeClick`, which refuses anything
 *      whose label reads like a write action or that would submit a POST form.
 *
 * Either level alone would stop a write; both are kept so that a mistake in
 * the portal map cannot result in a change to DPD data.
 */

import type { BrowserContext, Locator, Request } from "playwright";
import { PortalError } from "./errors";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Labels that indicate a control changes something. */
export const WRITE_ACTION_PATTERN =
  /\b(save|submit|approve|reject|decline|delete|remove|cancel|update|confirm|pay|send|create|add|edit|change|amend|accept|dispute|upload|assign|reset|deactivate|activate|terminate)\b/i;

export interface BlockedRequest {
  method: string;
  url: string;
  at: string;
}

export class ReadOnlyGuard {
  private phase: "login" | "browse" = "login";
  readonly blocked: BlockedRequest[] = [];

  constructor(
    private readonly loginPostPatterns: RegExp[],
    private readonly readOnlyPostPatterns: RegExp[],
  ) {}

  async install(context: BrowserContext): Promise<void> {
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (this.allows(request)) {
        await route.continue();
        return;
      }
      this.blocked.push({ method: request.method(), url: stripQuery(request.url()), at: new Date().toISOString() });
      await route.abort("blockedbyclient");
    });
  }

  allows(request: Pick<Request, "method" | "url">): boolean {
    const method = request.method().toUpperCase();
    if (SAFE_METHODS.has(method)) return true;
    if (method !== "POST") return false; // PUT, PATCH, DELETE are never allowed
    const url = request.url();
    if (this.phase === "login" && this.loginPostPatterns.some((p) => p.test(url))) return true;
    return this.readOnlyPostPatterns.some((p) => p.test(url));
  }

  /** Called once sign-in is confirmed: from here on the login POST is no longer allowed either. */
  endLoginPhase(): void {
    this.phase = "browse";
  }

  get currentPhase(): "login" | "browse" {
    return this.phase;
  }
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0] ?? url;
  }
}

/**
 * Clicks a navigation control, refusing anything that looks like a write.
 * Only links, tabs, menu items and clearly read-only buttons (view, search,
 * download…) can be clicked.
 */
export async function safeClick(locator: Locator, description: string): Promise<void> {
  const count = await locator.count();
  if (count === 0) {
    throw new PortalError("layout", `click:${description}`, `The DPD portal page did not contain “${description}”. The portal layout may have changed.`);
  }
  const element = locator.first();
  const info = await element.evaluate((el) => {
    const form = el.closest("form");
    return {
      text: ((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.getAttribute("value") || el.getAttribute("title") || "").trim().slice(0, 120),
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || "").toLowerCase(),
      formMethod: form ? (form.getAttribute("method") || "get").toLowerCase() : null,
    };
  });
  if (WRITE_ACTION_PATTERN.test(info.text) || WRITE_ACTION_PATTERN.test(description)) {
    throw new PortalError("config", `click:${description}`, "The portal setup tried to press a control that could change data. It was refused.", `Refused to click "${info.text || description}" (matches write-action pattern)`);
  }
  if (info.formMethod === "post" && (info.tag === "button" || info.type === "submit" || info.type === "image")) {
    throw new PortalError("config", `click:${description}`, "The portal setup tried to submit a form. It was refused.", `Refused to click "${info.text || description}" inside a POST form`);
  }
  await element.click();
}
