"use client";

import { useEffect, useRef, useState } from "react";
import { Check, FileText, Lock, Moon, ShieldCheck } from "lucide-react";
import { formatGBP } from "@/lib/money";
import { EXAMPLE_CHECKS, EXAMPLE_DAILY_INCOME, EXAMPLE_DRIVERS, EXAMPLE_PERIOD } from "@/lib/marketing/example";
import { cn } from "@/components/ui/cn";

/**
 * The hero: a phone that plays through what Franchise Books does, one step at a time — read DPD overnight, work out
 * driver pay, check it against the invoice, hand over the report. Example figures only. Without motion, it waits for
 * the visitor to tap a step.
 */

const STEP_MS = 3600;

const STEPS = [
  { label: "Read", caption: "Every night, we read your DPD portal." },
  { label: "Pay", caption: "Each driver's pay, worked out." },
  { label: "Check", caption: "Checked against DPD's own invoice." },
  { label: "Report", caption: "Your report, the Monday after each period." },
] as const;

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function useCountUp(target: number, run: boolean, ms = 900) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return value;
}

function Screen({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 flex flex-col px-4 pb-4 pt-3 transition-all duration-500 ease-out",
        active ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      {children}
    </div>
  );
}

function ReadScreen({ active }: { active: boolean }) {
  return (
    <Screen active={active}>
      <p className="inline-flex items-center gap-1.5 self-start rounded-full bg-ink px-2.5 py-1 text-[0.6875rem] font-semibold text-paper">
        <Moon className="size-3" aria-hidden /> Reading DPD
        <span className="mk-dots" aria-hidden><i /><i /><i /></span>
      </p>
      <p className="mt-3 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">Daily Payments</p>
      <ul className="mt-1.5 space-y-1.5">
        {DAYS.map((d, i) => (
          <li
            key={`${d}-${active}`}
            className={cn("flex items-center justify-between rounded-lg border border-line bg-surface px-3 py-2 text-sm", active && "mk-rise")}
            style={{ animationDelay: `${150 + i * 170}ms` }}
          >
            <span className="font-medium text-ink-soft">{d}</span>
            <span className="num font-semibold">{formatGBP(EXAMPLE_DAILY_INCOME[i])}</span>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function PayScreen({ active }: { active: boolean }) {
  const total = useCountUp(EXAMPLE_PERIOD.driverPay, active);
  const top = Math.max(...EXAMPLE_DRIVERS.map((d) => d.owed));
  return (
    <Screen active={active}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">Owed to Drivers</p>
      <p className="num mt-0.5 text-[2rem] font-semibold leading-tight tracking-tight">{formatGBP(total)}</p>
      <ul className="mt-4 space-y-3.5">
        {EXAMPLE_DRIVERS.map((d, i) => (
          <li key={d.name}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold">{d.name}</span>
              <span className="num font-semibold">{formatGBP(d.owed)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full origin-left rounded-full bg-accent-bar transition-transform duration-700 ease-out"
                style={{ width: `${(d.owed / top) * 100}%`, transform: active ? "scaleX(1)" : "scaleX(0)", transitionDelay: `${200 + i * 150}ms` }}
              />
            </div>
            <p className="num mt-0.5 text-xs text-muted">{d.basis === "Per day" ? `${d.quantity} days` : `${d.quantity} stops`}</p>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function CheckScreen({ active }: { active: boolean }) {
  const { dailyPayments, invoiceStopPay } = EXAMPLE_CHECKS.matches;
  return (
    <Screen active={active}>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">Period Check</p>
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <p className="text-[0.6875rem] text-muted">Your payments</p>
          <p className="num text-sm font-semibold">{formatGBP(dailyPayments)}</p>
        </div>
        <span className="text-lg font-semibold text-muted" aria-hidden>=</span>
        <div className="rounded-lg border border-line bg-surface p-2.5">
          <p className="text-[0.6875rem] text-muted">DPD invoice</p>
          <p className="num text-sm font-semibold">{formatGBP(invoiceStopPay)}</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span
          className={cn("grid size-20 place-items-center rounded-full bg-good text-white shadow-[0_12px_30px_-10px_rgb(28_110_69/0.7)]", active && "mk-pop")}
          style={{ animationDelay: "350ms" }}
        >
          <Check className="size-10" strokeWidth={3} aria-hidden />
        </span>
        <p className="mt-3 font-display text-xl font-semibold text-good">Matches DPD&rsquo;s Invoice</p>
      </div>
    </Screen>
  );
}

function ReportScreen({ active }: { active: boolean }) {
  const rows = [
    ["Income", EXAMPLE_PERIOD.income],
    ["DPD charges", -EXAMPLE_PERIOD.charges],
    ["Driver pay", -EXAMPLE_PERIOD.driverPay],
  ] as const;
  return (
    <Screen active={active}>
      <div className={cn("mt-1 rotate-[-2deg] rounded-lg border border-line-strong bg-surface p-4 shadow-[0_20px_40px_-20px_rgb(63_28_8/0.5)]", active && "mk-rise")}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><FileText className="size-4 text-accent" aria-hidden /> Period Report</p>
          <span className="rounded bg-accent px-1.5 py-0.5 text-[0.625rem] font-bold text-white">PDF</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">Northside, four weeks</p>
        <dl className="mt-3 space-y-1.5 text-sm">
          {rows.map(([label, v]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="num font-medium">{formatGBP(v)}</dd>
            </div>
          ))}
          <div className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold">
            <dt>Profit</dt>
            <dd className="num">{formatGBP(EXAMPLE_PERIOD.profit)}</dd>
          </div>
        </dl>
      </div>
      <p className="mt-auto rounded-lg bg-accent-soft px-3 py-2 text-center text-sm font-semibold text-accent-strong">Ready the Monday after each period</p>
    </Screen>
  );
}

export function HeroDemo() {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? true), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearTimeout(t);
  }, [auto, visible, step]);

  const playing = auto && visible;

  return (
    <div ref={root} className="mx-auto w-full max-w-[22rem]">
      <div className="relative mx-auto w-[16.5rem] sm:w-[17.5rem]">
        <div className="rounded-[2.6rem] bg-ink p-2.5 shadow-[0_40px_80px_-30px_rgb(40_14_0/0.75)]">
          <div className="relative aspect-[9/17] overflow-hidden rounded-[2.1rem] bg-paper text-ink">
            <div className="flex items-center justify-between px-4 pb-1 pt-4">
              <p className="font-display text-base font-semibold">Northside</p>
              <span className="rounded border border-line-strong px-1.5 py-0.5 text-[0.5625rem] font-semibold uppercase tracking-wider text-muted">Example Data</span>
            </div>
            <div className="relative h-[calc(100%-2.75rem)]">
              <ReadScreen active={step === 0} />
              <PayScreen active={step === 1} />
              <CheckScreen active={step === 2} />
              <ReportScreen active={step === 3} />
            </div>
          </div>
        </div>
        <p className="absolute -left-4 -top-3 z-10 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-lg sm:-left-12">
          <ShieldCheck className="size-3.5 text-good" aria-hidden /> Read-only
        </p>
        <p className="absolute -bottom-3 -right-4 z-10 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink shadow-lg sm:-right-12">
          <Lock className="size-3.5 text-good" aria-hidden /> Encrypted login
        </p>
      </div>

      <div className="mt-8 grid grid-cols-4 gap-2" role="tablist" aria-label="What Franchise Books does">
        {STEPS.map((s, i) => (
          <button
            key={s.label}
            type="button"
            role="tab"
            aria-selected={step === i}
            onClick={() => { setAuto(false); setStep(i); }}
            className="group text-left"
          >
            <span className="block h-1 overflow-hidden rounded-full bg-white/25">
              <span
                key={`${step}-${playing}`}
                className={cn("block h-full rounded-full bg-white", step === i ? (playing ? "mk-fill" : "w-full") : i < step ? "w-full opacity-60" : "w-0")}
                style={step === i && playing ? { animationDuration: `${STEP_MS}ms` } : undefined}
              />
            </span>
            <span className={cn("mt-2 block text-sm font-semibold transition-colors", step === i ? "text-white" : "text-white/60 group-hover:text-white/85")}>{s.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-2 min-h-[1.5rem] text-base font-semibold text-white">{STEPS[step]?.caption}</p>
    </div>
  );
}
