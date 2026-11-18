import type { Metadata } from "next";
import { ManageBillingForm } from "@/components/billing/forms";
import { CloseAccountForm } from "@/components/settings/close-account";
import { AddDpdLoginForm, RefreshDpdLoginButton, RemoveDpdLoginButton } from "@/components/settings/forms";
import { AddCategoryForm, AddFranchiseForm, AddRevenueButton, AlertSettingsForm, BusinessNameForm, CategoryToggle, DpdLoginForm, EditFranchiseButton, ScheduleForm, VoidRevenueButton } from "@/components/settings/forms";
import { Badge, DefinitionList, Notice, PageHeader, Panel, Section, TableWrap } from "@/components/ui/bits";
import { DEFAULT_ANOMALY_CONFIG, resolveAnomalyConfig } from "@/lib/anomalies/detect";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import { hasDpdLogin } from "@/lib/dpd/login";
import { listDpdLogins } from "@/lib/dpd/logins";
import { franchiseLabel, getContext } from "@/lib/context";
import { fetchAll } from "@/lib/data/fetch-all";
import { loadRevenue } from "@/lib/data/period";
import { addMonths, formatMonth, formatUkDate, monthOf, monthRange } from "@/lib/dates";
import { FIGURE_STATUS } from "@/lib/labels";
import { formatGBP } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const { supabase, accountId } = ctx;
  const month = monthOf(ctx.today);
  const [settings, franchises, categories, revenue, audit] = await Promise.all([
    supabase.from("app_settings").select("sync_time_local, sync_timezone, sync_enabled, auto_monthly_reports, revenue_allocation_basis, anomaly_config").eq("account_id", accountId).maybeSingle(),
    fetchAll(() => supabase.from("franchises").select("id, fd_number, name, depot, is_active, dpd_login_id, vehicle_type, vehicle_size, vehicle_fuel").eq("account_id", accountId).order("fd_number")),
    fetchAll(() => supabase.from("expense_categories").select("id, name, kind, is_system, is_active").eq("account_id", accountId).order("sort_order").order("id")),
    loadRevenue(supabase, { accountId, from: monthRange(addMonths(month, -12)).start, to: ctx.today }),
    ctx.canWrite ? supabase.from("audit_logs").select("id, action, entity_table, created_at, after").order("id", { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
  ]);
  const s = settings.data;
  const dpdSaved = ctx.isOwner ? await hasDpdLogin(createAdminClient(), accountId) : false;
  const listedLogins = ctx.isOwner ? await listDpdLogins(createAdminClient(), accountId) : [];
  const { data: billing } = ctx.isOwner ? await supabase.from("user_billing").select("status, current_period_end, cancel_at_period_end, stripe_customer_id").eq("user_id", ctx.userId).maybeSingle() : { data: null };
  const config = resolveAnomalyConfig(s?.anomaly_config);
  const franchiseName = new Map(ctx.franchises.map((f) => [f.id, franchiseLabel(f)]));
  const optionFranchises = franchises.filter((f) => f.is_active).map((f) => ({ id: f.id, label: f.name ? `${f.fd_number} · ${f.name}` : f.fd_number }));

  return (
    <>
      <PageHeader title="Settings" description="Your business, franchises, revenue, schedule and alert levels." />
      {!ctx.isOwner ? <Notice tone="info" className="mb-6">Only the owner can change settings. You can view them here.</Notice> : null}

      <Section title="Business">
        <Panel>{ctx.isOwner ? <BusinessNameForm name={ctx.accountName} /> : <DefinitionList items={[["Business name", ctx.accountName]]} />}</Panel>
      </Section>

      <Section id="franchises" title="Franchises" description="Each franchise is identified by its FD number, exactly as it appears on DPD documents.">
        <TableWrap>
          <table className="ledger">
            <thead><tr><th>FD number</th><th>Name</th><th>Depot</th><th>Status</th><th /></tr></thead>
            <tbody>
              {franchises.length === 0 ? <tr><td colSpan={5} className="text-muted">No franchises yet.</td></tr> : franchises.map((f) => (
                <tr key={f.id}>
                  <td className="num font-medium">{f.fd_number}</td><td>{f.name || "—"}</td><td>{f.depot ?? "—"}</td>
                  <td><Badge tone={f.is_active ? "good" : "neutral"}>{f.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td className="r">{ctx.isOwner ? <EditFranchiseButton franchise={{ id: f.id, fdNumber: f.fd_number, name: f.name, depot: f.depot, isActive: f.is_active, vehicleType: f.vehicle_type, vehicleSize: f.vehicle_size, vehicleFuel: f.vehicle_fuel }} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {ctx.isOwner ? <Panel className="mt-3"><AddFranchiseForm /></Panel> : null}
      </Section>

      <Section id="revenue" title="Franchise revenue" description="What DPD pays the franchise. This is kept separate from driver pay, and profit is only shown once revenue has been entered. Estimates are always labelled.">
        {ctx.isOwner && optionFranchises.length > 0 ? <div className="mb-3"><AddRevenueButton franchises={optionFranchises} currentMonth={month} today={ctx.today} /></div> : null}
        {revenue.length === 0 ? <Panel className="text-sm text-muted">No revenue entered yet. Until it is, the dashboard and reports show costs but not profit.</Panel> : (
          <TableWrap>
            <table className="ledger">
              <thead><tr><th>Franchise</th><th>Period</th><th>Status</th><th>Note</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {[...revenue].reverse().map((r) => (
                  <tr key={r.id}>
                    <td>{franchiseName.get(r.franchiseId) ?? ""}</td>
                    <td className="num whitespace-nowrap">{r.periodStart === r.periodEnd ? formatUkDate(r.periodStart) : formatMonth(r.periodStart.slice(0, 7))}</td>
                    <td><Badge tone={FIGURE_STATUS[r.status]!.tone}>{FIGURE_STATUS[r.status]!.label}</Badge></td>
                    <td className="text-sm">{r.description ?? "—"}</td>
                    <td className="r num font-semibold">{formatGBP(r.amount)}</td>
                    <td className="r">{ctx.isOwner ? <VoidRevenueButton id={r.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Section>

      <Section title="Schedule and reports">
        <Panel>
          {ctx.isOwner && s ? <ScheduleForm syncTime={s.sync_time_local} syncEnabled={s.sync_enabled} autoReports={s.auto_monthly_reports} basis={s.revenue_allocation_basis} /> : (
            <DefinitionList items={[["Evening sync", s ? `${s.sync_time_local.slice(0, 5)} UK time` : "—"], ["Automatic monthly reports", s?.auto_monthly_reports ? "On" : "Off"]]} />
          )}
        </Panel>
      </Section>

      {ctx.isOwner ? (
        <Section title="DPD logins" description="Each DPD login the app reads, and the franchise numbers it sees. All of them are read every evening, one after another. Add one for each login you use.">
          <Panel>
            <div className="mb-4 flex justify-end"><AddDpdLoginForm /></div>
            {listedLogins.length === 0 ? (
              <p className="text-sm text-muted">Only your original DPD login is in use. Add more here if other logins see other franchises.</p>
            ) : (
              <TableWrap>
                <table className="ledger">
                  <thead><tr><th>Login</th><th>Franchises it reads</th><th>Last read</th><th /></tr></thead>
                  <tbody>
                    {listedLogins.map((l) => (
                      <tr key={l.id}>
                        <td><span className="font-medium">{l.label}</span><br /><span className="text-xs text-muted">{l.username}</span></td>
                        <td>{franchises.filter((f) => f.dpd_login_id === l.id).map((f) => f.fd_number).join(", ") || <span className="text-muted">{l.lastError ? "None found" : "Finding them from DPD…"}</span>}</td>
                        <td>{l.lastError ? <span title={l.lastError}><Badge tone="bad">Could not read</Badge></span> : l.lastSuccessAt ? <span className="text-sm">{formatUkDate(l.lastSuccessAt.slice(0, 10))}</span> : <span className="text-muted">Not read yet</span>}</td>
                        <td className="r"><div className="flex justify-end gap-2"><RefreshDpdLoginButton id={l.id} /><RemoveDpdLoginButton id={l.id} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        </Section>
      ) : null}

      <Section title="DPD portal login" description="The login the app uses to sign in to the DPD portal for the nightly sync. It is stored encrypted, and only the owner can change it.">
        <Panel>
          {ctx.isOwner ? <DpdLoginForm saved={dpdSaved} /> : <p className="text-sm text-muted">Only the owner can change the DPD login.</p>}
        </Panel>
      </Section>

      {ctx.isOwner && billing ? (
        <Section title="Subscription" description={`Franchise Books by Winjo Digital is £${PLAN_PRICE_GBP} a month for your account, however many franchises you add.`}>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  Status
                  <Badge tone={billing.status === "active" || billing.status === "trialing" || billing.status === "comped" ? "good" : billing.status === "past_due" ? "warn" : "bad"}>
                    {billing.status === "comped" ? "Included with your account" : billing.status.replace("_", " ")}
                  </Badge>
                </p>
                {billing.current_period_end && billing.status !== "comped" ? (
                  <p className="text-muted">{billing.cancel_at_period_end ? "Ends" : "Renews"} on {formatUkDate(billing.current_period_end.slice(0, 10))}</p>
                ) : null}
                {billing.status === "past_due" ? <p className="text-warn">The last payment did not go through. Update your card to keep access.</p> : null}
              </div>
              {billing.stripe_customer_id ? <ManageBillingForm /> : null}
            </div>
          </Panel>
        </Section>
      ) : null}

      {ctx.isOwner ? (
        <Section title="Close account" description="Stop using Franchise Books and remove your DPD access.">
          <Panel>{params.closed ? <p className="mb-3 text-sm text-good">Your closure request is recorded. Check your email for what happens next.</p> : null}<CloseAccountForm /></Panel>
        </Section>
      ) : null}

      <Section title="Alert levels" description="How different from normal something must be before it is flagged. Each driver is compared with their own history, never with other drivers.">
        <Panel>
          {ctx.isOwner ? <AlertSettingsForm values={config as unknown as Record<string, number>} defaults={DEFAULT_ANOMALY_CONFIG as unknown as Record<string, number>} /> : <p className="text-sm text-muted">Only the owner can change alert levels.</p>}
        </Panel>
      </Section>

      <Section title="Expense categories" description="Add your own categories. Hiding one keeps it on existing expenses.">
        <TableWrap>
          <table className="ledger">
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium">{c.name}{c.is_system ? <Badge className="ml-2">Built in</Badge> : null}{!c.is_active ? <Badge tone="warn" className="ml-2">Hidden</Badge> : null}</td>
                  <td className="text-sm text-muted">{c.kind === "fuel" ? "Counts as fuel" : c.kind === "vehicle" ? "Vehicle cost" : "Other operating expense"}</td>
                  <td className="r">{ctx.canWrite && !c.is_system ? <CategoryToggle id={c.id} active={c.is_active} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {ctx.canWrite ? <Panel className="mt-3"><AddCategoryForm /></Panel> : null}
      </Section>

      {ctx.canWrite && (audit.data ?? []).length > 0 ? (
        <Section title="Recent changes" description="A permanent record of who changed what. It cannot be edited.">
          <Panel flush>
            <ul className="divide-y divide-line text-sm">
              {(audit.data ?? []).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <span><span className="font-medium capitalize">{a.action}</span> · {a.entity_table.replace(/_/g, " ")}</span>
                  <span className="text-muted">{new Date(a.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" })}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
