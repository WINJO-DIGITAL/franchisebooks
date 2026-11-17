import "server-only";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Completes an emailed link (password reset, invitation): exchanges the code or
 * token for a session, then sends the person to `next` (or to sign-in if the
 * link was expired, used already, or invalid).
 */
export async function completeEmailLink(request: NextRequest, next: string): Promise<NextResponse> {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const supabase = await createClient();
  let confirmed = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    confirmed = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
  }
  // A relative redirect keeps the person on the address they arrived on. (Inside route
  // handlers `nextUrl` can report the server's configured host instead.)
  return new NextResponse(null, { status: 307, headers: { location: confirmed ? safeNext : "/login" } });
}
