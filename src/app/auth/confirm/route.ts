import type { NextRequest } from "next/server";
import { completeEmailLink } from "@/lib/auth-link";

/** Completes general email links (for example invitations). `?next=` says where to go afterwards. */
export async function GET(request: NextRequest) {
  return completeEmailLink(request, request.nextUrl.searchParams.get("next") ?? "/");
}
