import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "viewer";
  /** True when they see every franchise; otherwise `franchiseIds` lists the ones they can see. */
  allFranchises: boolean;
  franchiseIds: string[];
}

/** The people on an account: the owner first, then everyone else by name. Read with the service role, for the owner's Settings page only. */
export async function loadTeam(accountId: string): Promise<TeamMember[]> {
  const admin = createAdminClient();
  const { data: profiles } = await admin.from("user_profiles").select("id, full_name, role, all_franchises").eq("account_id", accountId);
  const people = profiles ?? [];
  if (people.length === 0) return [];
  const { data: access } = await admin.from("user_franchise_access").select("user_id, franchise_id").in("user_id", people.map((p) => p.id));
  const emails = await Promise.all(people.map(async (p) => [p.id, (await admin.auth.admin.getUserById(p.id)).data.user?.email ?? ""] as const));
  const emailOf = new Map(emails);
  return people
    .map((p) => ({
      id: p.id,
      name: p.full_name,
      email: emailOf.get(p.id) ?? "",
      role: p.role as TeamMember["role"],
      allFranchises: p.all_franchises === true,
      franchiseIds: (access ?? []).filter((a) => a.user_id === p.id).map((a) => a.franchise_id),
    }))
    .sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0) || a.name.localeCompare(b.name, "en-GB"));
}
