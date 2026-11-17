import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/context";
import { safeEqual, verifyState } from "@/lib/crypto";
import { DropboxClient, exchangeCode } from "@/lib/dropbox/client";
import { saveTokens } from "@/lib/dropbox/connection";
import { env } from "@/lib/env";
import { reportError } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface OAuthState {
  accountId: string;
  userId: string;
  nonce: string;
  exp: number;
}

/** Completes the Dropbox OAuth 2.0 flow and stores the (encrypted) refresh token. */
export async function GET(request: NextRequest) {
  const back = new URL("/data", env.appUrl());
  const finish = (outcome: string) => {
    back.searchParams.set("dropbox", outcome);
    const response = NextResponse.redirect(back);
    response.cookies.delete({ name: "dropbox_oauth", path: "/api/dropbox" });
    return response;
  };

  const ctx = await getContext();
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish(params.get("error") === "access_denied" ? "cancelled" : "error");

  const state = verifyState<OAuthState>(params.get("state") ?? "");
  const nonce = request.cookies.get("dropbox_oauth")?.value ?? "";
  const code = params.get("code");
  if (!state || !code || state.exp < Date.now() || !nonce || !safeEqual(state.nonce, nonce) || state.accountId !== ctx.accountId || state.userId !== ctx.userId || !ctx.isOwner) {
    return finish("invalid");
  }

  try {
    const { tokens, accountId: dropboxAccountId } = await exchangeCode(code);
    const db = createAdminClient();
    const client = new DropboxClient(tokens, async () => undefined);
    const account = await client.currentAccount();
    const { data: connection, error } = await db
      .from("integration_connections")
      .upsert(
        { account_id: ctx.accountId, provider: "dropbox", status: "connected", display_name: account.email, external_account_id: dropboxAccountId, last_error: null, created_by: ctx.userId },
        { onConflict: "account_id,provider" },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await saveTokens(db, connection.id, tokens);
    await db.from("sync_logs").insert({ account_id: ctx.accountId, integration: "dropbox", level: "info", event: "connected", message: `Dropbox connected (${account.email}).` });
    return finish("connected");
  } catch (error) {
    await reportError(error, { where: "dropbox.callback" });
    return finish("error");
  }
}
