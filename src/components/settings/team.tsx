"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inviteTeamMember, removeTeamMember, updateTeamMember } from "@/lib/actions/team";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/bits";
import { Field, Input, Select } from "@/components/ui/form";
import type { TeamMember } from "@/lib/data/team";

interface FranchiseOption {
  id: string;
  label: string;
}

const ROLE_TEXT = { owner: "Owner", manager: "Manager", viewer: "Viewer" } as const;

/** Role, which franchises, and the ticked list when it is only some. Shared by the invite form and each member's edit form. */
function AccessFields({ franchises, role, allFranchises, franchiseIds, errors }: {
  franchises: FranchiseOption[]; role: "manager" | "viewer"; allFranchises: boolean; franchiseIds: string[]; errors?: Record<string, string>;
}) {
  const [access, setAccess] = useState<"all" | "some">(allFranchises ? "all" : "some");
  return (
    <>
      <Field label="Role" hint="A manager can add and change data. A viewer can only look.">
        <Select name="role" defaultValue={role}>
          <option value="manager">Manager</option>
          <option value="viewer">Viewer</option>
        </Select>
      </Field>
      <Field label="Which Franchises?" error={errors?.access}>
        <Select name="access" value={access} onChange={(e) => setAccess(e.target.value as "all" | "some")}>
          <option value="all">All franchises</option>
          <option value="some">Only the ones I choose</option>
        </Select>
      </Field>
      {access === "some" ? (
        <Field label="Franchises They Can See" className="sm:col-span-2" error={errors?.franchiseIds}>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {franchises.map((f) => (
              <label key={f.id} className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" name="franchiseIds" value={f.id} defaultChecked={franchiseIds.includes(f.id)} className="size-4 accent-[var(--color-accent)]" />
                {f.label}
              </label>
            ))}
          </div>
        </Field>
      ) : null}
    </>
  );
}

export function TeamPanel({ members, franchises, currentUserId }: { members: TeamMember[]; franchises: FranchiseOption[]; currentUserId: string }) {
  const router = useRouter();
  const nameOf = new Map(franchises.map((f) => [f.id, f.label]));
  return (
    <div className="space-y-6">
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {members.map((m) => (
          <li key={m.id} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{m.name || m.email}{m.id === currentUserId ? <span className="font-normal text-muted"> · you</span> : null}</p>
                <p className="text-sm text-muted">{m.email} · {m.role === "owner" || m.allFranchises ? "All franchises" : m.franchiseIds.map((id) => nameOf.get(id) ?? "A franchise").join(", ") || "No franchises yet"}</p>
              </div>
              <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_TEXT[m.role]}</Badge>
            </div>
            {m.role !== "owner" ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-accent">Change or remove</summary>
                <div className="mt-3 grid gap-4">
                  <ActionForm action={updateTeamMember} className="grid gap-4 sm:grid-cols-2" onSuccess={() => router.refresh()}>
                    {(state) => (
                      <>
                        <input type="hidden" name="userId" value={m.id} />
                        <AccessFields franchises={franchises} role={m.role as "manager" | "viewer"} allFranchises={m.allFranchises} franchiseIds={m.franchiseIds} errors={state.fieldErrors} />
                        <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Saving…">Save Changes</SubmitButton></div>
                      </>
                    )}
                  </ActionForm>
                  <ActionForm action={removeTeamMember} onSuccess={() => router.refresh()}>
                    <input type="hidden" name="userId" value={m.id} />
                    <SubmitButton variant="quiet" pendingLabel="Removing…">Remove Their Access</SubmitButton>
                  </ActionForm>
                </div>
              </details>
            ) : null}
          </li>
        ))}
      </ul>

      <ActionForm action={inviteTeamMember} className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2" resetOnSuccess onSuccess={() => router.refresh()}>
        {(state) => (
          <>
            <Field label="Their Name" error={state.fieldErrors?.fullName}>
              <Input name="fullName" autoComplete="off" maxLength={120} />
            </Field>
            <Field label="Their Email" error={state.fieldErrors?.email}>
              <Input name="email" type="email" autoComplete="off" />
            </Field>
            <AccessFields franchises={franchises} role="manager" allFranchises errors={state.fieldErrors} franchiseIds={[]} />
            <div className="sm:col-span-2"><SubmitButton pendingLabel="Sending…">Send Invitation</SubmitButton></div>
          </>
        )}
      </ActionForm>
    </div>
  );
}
