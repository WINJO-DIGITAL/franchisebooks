"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Lock, ShieldCheck } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * The hero: a phone playing through the real app, one screen at a time. The screens are captures of the demo account,
 * whose names and figures are all synthetic. Without motion, it waits for the visitor to tap a step.
 */

const STEP_MS = 3400;

const STEPS = [
  { label: "Read", src: "/marketing/phone-dash.webp", caption: "Every night, we read your DPD portal.", alt: "Dashboard showing the latest DPD report: income, drivers working, stops and parcels." },
  { label: "Pay", src: "/marketing/phone-drivers.webp", caption: "What each driver is owed, worked out.", alt: "Drivers this pay period, with each driver's income and wage." },
  { label: "Profit", src: "/marketing/phone-period.webp", caption: "Income, wages, costs and profit.", alt: "Pay period to date: income, wages, expenses and profit, with income per day." },
  { label: "Costs", src: "/marketing/phone-expenses.webp", caption: "Every cost, with the VAT stated.", alt: "Expenses for the pay period, before and with VAT." },
] as const;

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
      <div className="relative mx-auto w-[16.5rem] sm:w-[18rem]">
        <div className="rounded-[2.6rem] bg-ink p-2.5 shadow-[0_40px_80px_-30px_rgb(40_14_0/0.75)]">
          <div className="relative aspect-[390/664] overflow-hidden rounded-[2.1rem] bg-paper">
            {STEPS.map((s, i) => (
              <Image
                key={s.src}
                src={s.src}
                alt={s.alt}
                aria-hidden={step !== i}
                fill
                sizes="18rem"
                priority={i === 0}
                className={cn("object-cover object-top transition-all duration-700 ease-out", step === i ? "scale-100 opacity-100" : "scale-[1.03] opacity-0")}
              />
            ))}
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
      <p className="mt-1 text-xs text-white/70">Real screens from a demo account. Every name and figure is made up.</p>
    </div>
  );
}
