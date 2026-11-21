import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadTeam } from "@/lib/data/team";
import { adminClient } from "../helpers/app";
import { addMember, createTestAccount, pool, sql, type TestAccount } from "../helpers/db";

let t: TestAccount;
let manager: string;
let viewer: string;

beforeAll(async () => {
  t = await createTestAccount("Team Ltd");
  manager = await addMember(t.accountId, "manager", "all");
  viewer = await addMember(t.accountId, "viewer", [t.franchiseId]);
}, 60_000);
afterAll(() => pool.end());

describe("team list", () => {
  it("lists the owner first, then the other members, by role", async () => {
    const team = await loadTeam(t.accountId);
    expect(team.map((m) => m.role)).toEqual(["owner", "manager", "viewer"]);
  });

  it("shows a real member's email address from their login", async () => {
    const email = `real-member-${Date.now()}@example.test`;
    const created = await adminClient().auth.admin.createUser({ email, password: "member-password-123", email_confirm: true });
    const id = created.data.user!.id;
    await sql("insert into public.user_profiles (id, account_id, full_name, role, all_franchises) values ($1, $2, 'Real Member', 'viewer', true)", [id, t.accountId]);
    const team = await loadTeam(t.accountId);
    expect(team.find((m) => m.id === id)).toMatchObject({ email, name: "Real Member", role: "viewer" });
  });

  it("shows which franchises a limited member can see, and that others see all", async () => {
    const team = await loadTeam(t.accountId);
    expect(team.find((m) => m.id === manager)).toMatchObject({ allFranchises: true, franchiseIds: [] });
    expect(team.find((m) => m.id === viewer)).toMatchObject({ allFranchises: false, franchiseIds: [t.franchiseId] });
  });

  it("does not list people from another business", async () => {
    const other = await createTestAccount("Other Team Ltd");
    const team = await loadTeam(other.accountId);
    expect(team).toHaveLength(1);
    expect(team[0]!.role).toBe("owner");
  });
});
