import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { londonToday } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const FRANCHISE_COOKIE = "franchise";

export interface FranchiseOption {
  id: string;
  fdNumber: string;
  name: string;
  isActive: boolean;
}

export function franchiseLabel(f: Pick<FranchiseOption, "fdNumber" | "name">): string {
  return f.name ? `${f.fdNumber} · ${f.name}` : f.fdNumber;
}

/**
 * Everything a page needs to know about who is signed in. Redirects to the
 * login or onboarding page when there is no session or no business yet.
 * Cached for the duration of a request.
 */
export const getContext = cache(async () => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, account_id, full_name, role, all_franchises")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (!profile) redirect("/onboarding");

  const [{ data: account }, { data: franchiseRows }, cookieStore] = await Promise.all([
    supabase.from("accounts").select("id, name").eq("id", profile.account_id).maybeSingle(),
    supabase.from("franchises").select("id, fd_number, name, is_active").eq("account_id", profile.account_id).order("fd_number"),
    cookies(),
  ]);

  const franchises: FranchiseOption[] = (franchiseRows ?? []).map((f) => ({ id: f.id, fdNumber: f.fd_number, name: f.name, isActive: f.is_active }));
  const selectedId = cookieStore.get(FRANCHISE_COOKIE)?.value;
  const franchise = franchises.find((f) => f.id === selectedId) ?? null;

  return {
    supabase,
    userId: auth.user.id,
    email: auth.user.email ?? "",
    fullName: profile.full_name,
    role: profile.role as "owner" | "manager" | "viewer",
    canWrite: profile.role === "owner" || profile.role === "manager",
    isOwner: profile.role === "owner",
    accountId: profile.account_id,
    accountName: account?.name ?? "",
    franchises,
    /** The franchise chosen in the header switcher, or null for "All franchises". */
    franchise,
    franchiseId: franchise?.id ?? null,
    today: londonToday(),
  };
});

export type AppContext = Awaited<ReturnType<typeof getContext>>;
