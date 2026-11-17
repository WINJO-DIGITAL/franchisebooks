import type { NextRequest } from "next/server";
import { completeEmailLink } from "@/lib/auth-link";

/**
 * Where the password-reset email link lands. It has no query string on purpose:
 * Supabase only redirects to addresses on its allow-list, and an exact address
 * is safer than a wildcard.
 */
export async function GET(request: NextRequest) {
  return completeEmailLink(request, "/reset-password");
}
