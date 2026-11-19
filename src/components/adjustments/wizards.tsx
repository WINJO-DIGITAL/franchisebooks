"use client";

import Link from "next/link";
import { useActionState, useMemo, useState, type ReactNode } from "react";
import { createAdjustment, recordCover } from "@/lib/actions/adjustments";
import type { ActionState } from "@/lib/actions/helpers";
import { ActionMessage } from "@/components/ui/action-form";
import { Notice, Panel } from "@/components/ui/bits";
import { Button, buttonClass } from "@/components/ui/button";
import { ChoiceCard, Field, Input, Select, Textarea } from "@/components/ui/form";
import { formatUkDateLong, isISODate } from "@/lib/dates";
import { ADJUSTMENT_TYPES } from "@/lib/labels";
import { formatGBP, parseMoney } from "@/lib/money";

const initial: ActionState = { ok: false, message: "" };

export interface WizardDriver {
  id: string;
  name: string;
  franchiseIds: string[];
  isActive: boolean;
}

interface Option {
  id: string;
  label: string;
}

function StepShell({ step, total, question, children, onBack, onNext, nextLabel = "Continue", error, final, pending }: {
  step: number; total: number; question: string; children: ReactNode; onBack?: () => void; onNext?: () => void; nextLabel?: string; error?: string | null; final?: boolean; pending?: boolean;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-muted" aria-live="polite">Step {step} of {total}</p>
      <div className="mt-2 h-1 rounded-full bg-sunken" aria-hidden>
        <div className="h-1 rounded-full bg-accent" style={{ width: `${(step / total) * 100}%` }} />
      </div>
      <h2 className="mt-5 text-xl font-semibold tracking-tight">{question}</h2>
      <div className="mt-5 space-y-4">{children}</div>
      {error ? <p className="mt-4 text-sm text-bad" role="alert">{error}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {final ? <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : nextLabel}</Button> : <Button type="button" size="lg" onClick={onNext}>{nextLabel}</Button>}
        {onBack ? <Button type="button" variant="quiet" onClick={onBack}>Back</Button> : null}
      </div>
    </div>
  );
}

function useDriversFor(drivers: WizardDriver[], franchiseId: string) {
  return useMemo(() => {
    const active = drivers.filter((d) => d.isActive);
    const assigned = active.filter((d) => d.franchiseIds.includes(franchiseId));
    const others = active.filter((d) => !d.franchiseIds.includes(franchiseId));
    return { assigned, others };
  }, [drivers, franchiseId]);
}

function DriverSelect({ name, value, onChange, drivers, franchiseId, exclude }: { name: string; value: string; onChange: (id: string) => void; drivers: WizardDriver[]; franchiseId: string; exclude?: string }) {
  const { assigned, others } = useDriversFor(drivers, franchiseId);
  const option = (d: WizardDriver) => (d.id === exclude ? null : <option key={d.id} value={d.id}>{d.name}</option>);
  return (
    <Select name={name} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>Choose a driver…</option>
      {assigned.length ? <optgroup label="On this franchise">{assigned.map(option)}</optgroup> : null}
      {others.length ? <optgroup label="Other drivers">{others.map(option)}</optgroup> : null}
    </Select>
  );
}

// ── Pay adjustment ──────────────────────────────────────────────────────────

export function AdjustmentWizard({ franchises, drivers, today, defaults }: {
  franchises: Option[]; drivers: WizardDriver[]; today: string; defaults: { franchiseId?: string | null; driverId?: string | null; date?: string | null };
}) {
  const [state, action, pending] = useActionState(createAdjustment, initial);
  const defaultDriver = drivers.find((d) => d.id === defaults.driverId);
  const [franchiseId, setFranchiseId] = useState(defaults.franchiseId ?? defaultDriver?.franchiseIds[0] ?? (franchises.length === 1 ? franchises[0]!.id : ""));
  const [driverId, setDriverId] = useState(defaultDriver?.id ?? "");
  const [date, setDate] = useState(defaults.date && isISODate(defaults.date) ? defaults.date : today);
  const [type, setType] = useState("additional_payment");
  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const typeInfo = ADJUSTMENT_TYPES.find((t) => t.value === type)!;
  const pence = parseMoney(amount);
  const sign = typeInfo.sign !== 0 ? typeInfo.sign : direction === "deduct" ? -1 : 1;
  const signed = pence == null ? null : pence === 0 ? 0 : sign * pence;
  const driver = drivers.find((d) => d.id === driverId);
  const franchise = franchises.find((f) => f.id === franchiseId);

  const next = () => {
    setError(null);
    if (step === 1 && (!franchiseId || !driverId)) return setError("Choose the franchise and the driver.");
    if (step === 2 && (!isISODate(date) || date > today)) return setError("Choose a date that is today or earlier.");
    if (step === 3) {
      if (pence == null) return setError("Enter the amount in pounds and pence, for example 50 or 50.00.");
      if (pence === 0 && type !== "withheld_payment") return setError("Enter an amount greater than zero. Only a withheld payment can be recorded as £0.");
    }
    if (step === 4 && reason.trim().length < 3) return setError("Say briefly why, so it is clear later.");
    setStep(step + 1);
  };
  const back = () => { setError(null); setStep(step - 1); };

  if (state.ok) {
    return (
      <Panel>
        <ActionMessage state={state} />
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/adjustments/new" className={buttonClass("primary")}>Add another</a>
          <Link href="/adjustments" className={buttonClass("secondary")}>View adjustments</Link>
          {driver ? <Link href={`/drivers/${driver.id}`} className={buttonClass("quiet")}>View {driver.name}</Link> : null}
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <form action={action} noValidate>
        <input type="hidden" name="franchiseId" value={franchiseId} />
        <input type="hidden" name="driverId" value={driverId} />
        <input type="hidden" name="earningsDate" value={date} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="direction" value={direction} />
        <input type="hidden" name="amount" value={amount} />
        <input type="hidden" name="reason" value={reason} />
        <input type="hidden" name="confirmed" value={step === 5 ? "yes" : "no"} />

        {step === 1 ? (
          <StepShell step={1} total={5} question="Who is the payment for?" onNext={next} error={error}>
            {franchises.length > 1 ? (
              <Field label="Franchise">
                <Select value={franchiseId} onChange={(e) => { setFranchiseId(e.target.value); }}>
                  <option value="" disabled>Choose a franchise…</option>
                  {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </Field>
            ) : null}
            <Field label="Driver">
              <DriverSelect name="driver-picker" value={driverId} onChange={setDriverId} drivers={drivers} franchiseId={franchiseId} />
            </Field>
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell step={2} total={5} question="Which day?" onNext={next} onBack={back} error={error}>
            <Field label="The day the adjustment applies to" hint={isISODate(date) ? formatUkDateLong(date) : undefined}>
              <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell step={3} total={5} question="What kind, and how much?" onNext={next} onBack={back} error={error}>
            <div className="grid gap-2 sm:grid-cols-2">
              {ADJUSTMENT_TYPES.map((t) => (
                <ChoiceCard key={t.value} name="type-picker" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} title={t.label} description={t.help} />
              ))}
            </div>
            {typeInfo.sign === 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <ChoiceCard name="direction-picker" value="add" checked={direction === "add"} onChange={() => setDirection("add")} title="Add to Their Pay" />
                <ChoiceCard name="direction-picker" value="deduct" checked={direction === "deduct"} onChange={() => setDirection("deduct")} title="Take Off Their Pay" />
              </div>
            ) : null}
            <Field label="How much?" hint={type === "withheld_payment" ? "Enter 0 to record that a payment was withheld without changing pay." : "In pounds, for example 50 or 50.00."}>
              <div className="relative max-w-xs">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">£</span>
                <Input inputMode="decimal" className="num pl-7 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" autoComplete="off" />
              </div>
            </Field>
          </StepShell>
        ) : null}

        {step === 4 ? (
          <StepShell step={4} total={5} question="Why?" onNext={next} onBack={back} error={error}>
            <Field label="Reason" hint="For example: covered an extra route, agreed deduction, one-off bonus.">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          </StepShell>
        ) : null}

        {step === 5 ? (
          <StepShell step={5} total={5} question="Check and confirm" onBack={back} nextLabel="Save adjustment" final pending={pending}>
            <div className="rounded-lg border border-line-strong bg-paper p-4">
              <p className="num text-3xl font-semibold tracking-tight">{signed == null ? "—" : formatGBP(signed, { signed: true })}</p>
              <p className="mt-1 text-[0.9375rem]">
                {signed != null && signed < 0 ? "taken off" : signed === 0 ? "recorded for" : "added to"} <strong>{driver?.name}</strong>&rsquo;s pay for <strong>{formatUkDateLong(date)}</strong>
              </p>
              <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Type</dt><dd>{typeInfo.label}</dd></div>
                {franchise ? <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Franchise</dt><dd>{franchise.label}</dd></div> : null}
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Reason</dt><dd>{reason}</dd></div>
              </dl>
            </div>
            <Notice tone="info">The original DPD figure is not changed. This adjustment is recorded separately and can be reversed later with a correcting entry.</Notice>
            {state.message ? <ActionMessage state={state} /> : null}
          </StepShell>
        ) : null}
      </form>
    </Panel>
  );
}

// ── Driver cover ────────────────────────────────────────────────────────────

export function CoverWizard({ franchises, drivers, today, defaults }: {
  franchises: Option[]; drivers: WizardDriver[]; today: string; defaults: { franchiseId?: string | null; originalDriverId?: string | null; date?: string | null };
}) {
  const [state, action, pending] = useActionState(recordCover, initial);
  const defaultOriginal = drivers.find((d) => d.id === defaults.originalDriverId);
  const [franchiseId, setFranchiseId] = useState(defaults.franchiseId ?? defaultOriginal?.franchiseIds[0] ?? (franchises.length === 1 ? franchises[0]!.id : ""));
  const [date, setDate] = useState(defaults.date && isISODate(defaults.date) ? defaults.date : today);
  const [originalId, setOriginalId] = useState(defaultOriginal?.id ?? "");
  const [coveringId, setCoveringId] = useState("");
  const [route, setRoute] = useState("");
  const [notes, setNotes] = useState("");
  const [allocation, setAllocation] = useState<"none" | "all_to_cover" | "custom">("none");
  const [toCovering, setToCovering] = useState("");
  const [fromOriginal, setFromOriginal] = useState("");
  const [expenses, setExpenses] = useState<"original" | "covering" | "franchise">("original");
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const original = drivers.find((d) => d.id === originalId);
  const covering = drivers.find((d) => d.id === coveringId);
  const franchise = franchises.find((f) => f.id === franchiseId);
  const toPence = parseMoney(toCovering || "0");
  const fromPence = parseMoney(fromOriginal || "0");

  const next = () => {
    setError(null);
    if (step === 1 && (!franchiseId || !isISODate(date) || date > today)) return setError("Choose the franchise and a date that is today or earlier.");
    if (step === 2) {
      if (!originalId || !coveringId) return setError("Choose both drivers.");
      if (originalId === coveringId) return setError("The covering driver must be a different person.");
    }
    if (step === 3 && allocation === "custom") {
      if (toPence == null || fromPence == null) return setError("Enter amounts in pounds and pence, for example 50 or 50.00.");
      if (toPence === 0 && fromPence === 0) return setError("Enter at least one amount, or choose “Just record the cover”.");
    }
    setStep(step + 1);
  };
  const back = () => { setError(null); setStep(step - 1); };

  if (state.ok) {
    return (
      <Panel>
        <ActionMessage state={state} />
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/adjustments/cover" className={buttonClass("primary")}>Record another</a>
          <Link href="/adjustments" className={buttonClass("secondary")}>View adjustments</Link>
        </div>
      </Panel>
    );
  }

  const paySummary =
    allocation === "none" ? "No pay changes. The cover is recorded for reference only."
      : allocation === "all_to_cover" ? `All of ${original?.name ?? "the original driver"}'s DPD earnings for the day move to ${covering?.name ?? "the covering driver"}.`
        : [toPence ? `${formatGBP(toPence)} added to ${covering?.name}'s pay` : null, fromPence ? `${formatGBP(fromPence)} taken off ${original?.name}'s pay` : null].filter(Boolean).join("; ") + ".";
  const expenseSummary = expenses === "original" ? `stay with ${original?.name}` : expenses === "covering" ? `count against ${covering?.name}` : "count against the franchise, not a driver";

  return (
    <Panel>
      <form action={action} noValidate>
        <input type="hidden" name="franchiseId" value={franchiseId} />
        <input type="hidden" name="coverDate" value={date} />
        <input type="hidden" name="originalDriverId" value={originalId} />
        <input type="hidden" name="coveringDriverId" value={coveringId} />
        <input type="hidden" name="route" value={route} />
        <input type="hidden" name="notes" value={notes} />
        <input type="hidden" name="allocation" value={allocation} />
        <input type="hidden" name="amountToCovering" value={toCovering} />
        <input type="hidden" name="amountFromOriginal" value={fromOriginal} />
        <input type="hidden" name="expenseAttribution" value={expenses} />
        <input type="hidden" name="confirmed" value={step === 5 ? "yes" : "no"} />

        {step === 1 ? (
          <StepShell step={1} total={5} question="When was the cover?" onNext={next} error={error}>
            <Field label="Date" hint={isISODate(date) ? formatUkDateLong(date) : undefined}>
              <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {franchises.length > 1 ? (
              <Field label="Franchise">
                <Select value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)}>
                  <option value="" disabled>Choose a franchise…</option>
                  {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              </Field>
            ) : null}
          </StepShell>
        ) : null}

        {step === 2 ? (
          <StepShell step={2} total={5} question="Who covered for whom?" onNext={next} onBack={back} error={error}>
            <Field label="Whose work was covered?">
              <DriverSelect name="original-picker" value={originalId} onChange={setOriginalId} drivers={drivers} franchiseId={franchiseId} />
            </Field>
            <Field label="Who covered it?">
              <DriverSelect name="covering-picker" value={coveringId} onChange={setCoveringId} drivers={drivers} franchiseId={franchiseId} exclude={originalId} />
            </Field>
            <Field label="Route or work covered (optional)">
              <Input value={route} onChange={(e) => setRoute(e.target.value)} maxLength={60} />
            </Field>
            <Field label="Notes (optional)">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
            </Field>
          </StepShell>
        ) : null}

        {step === 3 ? (
          <StepShell step={3} total={5} question="How should pay be handled?" onNext={next} onBack={back} error={error}>
            <ChoiceCard name="allocation-picker" value="none" checked={allocation === "none"} onChange={() => setAllocation("none")} title="Just Record the Cover" description="No pay changes. You can add adjustments separately later." />
            <ChoiceCard name="allocation-picker" value="all_to_cover" checked={allocation === "all_to_cover"} onChange={() => setAllocation("all_to_cover")} title="Move the Day's DPD Earnings to the Covering Driver" description="The original driver's imported earnings for that day are taken off their pay and added to the covering driver's." />
            <ChoiceCard name="allocation-picker" value="custom" checked={allocation === "custom"} onChange={() => setAllocation("custom")} title="I'll Enter the Amounts" description="For a fixed cover payment, a split, or anything else you agreed." />
            {allocation === "custom" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={`Add to ${covering?.name ?? "covering driver"}'s pay`}>
                  <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">£</span>
                    <Input inputMode="decimal" className="num pl-7" value={toCovering} onChange={(e) => setToCovering(e.target.value)} placeholder="0.00" /></div>
                </Field>
                <Field label={`Take off ${original?.name ?? "original driver"}'s pay`} hint="Leave at 0 if they keep their pay.">
                  <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">£</span>
                    <Input inputMode="decimal" className="num pl-7" value={fromOriginal} onChange={(e) => setFromOriginal(e.target.value)} placeholder="0.00" /></div>
                </Field>
              </div>
            ) : null}
          </StepShell>
        ) : null}

        {step === 4 ? (
          <StepShell step={4} total={5} question="What about fuel and expenses for that day?" onNext={next} onBack={back} error={error}>
            <ChoiceCard name="expense-picker" value="original" checked={expenses === "original"} onChange={() => setExpenses("original")} title={`Leave them with ${original?.name ?? "the original driver"}`} description="Costs stay wherever they are already attributed." />
            <ChoiceCard name="expense-picker" value="covering" checked={expenses === "covering"} onChange={() => setExpenses("covering")} title={`Count them against ${covering?.name ?? "the covering driver"}`} description="For example, fuel bought for the usual driver's van that day." />
            <ChoiceCard name="expense-picker" value="franchise" checked={expenses === "franchise"} onChange={() => setExpenses("franchise")} title="Count Them Against the Franchise, Not a Driver" />
          </StepShell>
        ) : null}

        {step === 5 ? (
          <StepShell step={5} total={5} question="Check and confirm" onBack={back} nextLabel="Save cover record" final pending={pending}>
            <div className="rounded-lg border border-line-strong bg-paper p-4 text-[0.9375rem]">
              <p className="text-lg font-semibold"><strong>{covering?.name}</strong> covered <strong>{original?.name}</strong></p>
              <p className="mt-0.5 text-muted">{formatUkDateLong(date)}{franchise ? ` · ${franchise.label}` : ""}{route ? ` · ${route}` : ""}</p>
              <dl className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Pay</dt><dd>{paySummary}</dd></div>
                <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Expenses</dt><dd>That day&rsquo;s fuel and expenses {expenseSummary}.</dd></div>
                {notes ? <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Notes</dt><dd>{notes}</dd></div> : null}
              </dl>
            </div>
            <Notice tone="info">The original DPD figures are not changed. The agreed allocation is stored separately and can be cancelled later.</Notice>
            {state.message ? <ActionMessage state={state} /> : null}
          </StepShell>
        ) : null}
      </form>
    </Panel>
  );
}
