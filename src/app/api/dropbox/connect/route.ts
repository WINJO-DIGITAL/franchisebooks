import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { signState } from "@/lib/crypto";
import { buildAuthorizeUrl, DropboxError } from "@/lib/dropbox/client";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Starts the Dropbox OAuth 2.0 flow ("Connect Dropbox" button). */
export async function GET() {
  const ctx = await getContext();
  const back = new URL("/data", env.appUrl());
  if (!ctx.isOwner) {
    back.searchParams.set("dropbox", "forbidden");
    return NextResponse.redirect(back);
  }
  try {
    const nonce = randomBytes(16).toString("hex");
    const state = signState({ accountId: ctx.accountId, userId: ctx.userId, nonce, exp: Date.now() + 10 * 60_000 });
    const response = NextResponse.redirect(buildAuthorizeUrl(state));
    // The nonce is also kept in a cookie, so the callback can prove the flow started in this browser.
    response.cookies.set("dropbox_oauth", nonce, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/api/dropbox" });
    return response;
  } catch (error) {
    back.searchParams.set("dropbox", error instanceof DropboxError && error.kind === "not_configured" ? "not_configured" : "error");
    return NextResponse.redirect(back);
  }
}
