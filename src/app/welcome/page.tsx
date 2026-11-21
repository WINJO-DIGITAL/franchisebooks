import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileCheck, Lock, Plus, ShieldCheck } from "lucide-react";
import "@fontsource-variable/source-serif-4";
import { buttonClass } from "@/components/ui/button";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import { HowFlow } from "@/components/marketing/how-flow";
import { HeroPayday } from "@/components/marketing/hero-payday";
import { SiteFooter, SiteHeader } from "@/components/marketing/site-chrome";

const TITLE = "Franchise Books by Winjo Digital: know what your DPD franchise earns and what each driver is owed";
const DESCRIPTION = "Connect your DPD login once. Every night Franchise Books reads your payments and charges, works out each driver's pay, and has a report ready for payday.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: true, follow: true },
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Franchise Books" },
};

const PRICE = PLAN_PRICE_GBP.standard;

const TRUST = [
  { icon: ShieldCheck, title: "Read-Only", text: "It can never change anything in DPD." },
  { icon: Lock, title: "Encrypted Login", text: "Only the app can read it." },
  { icon: FileCheck, title: "DPD's Own Figures", text: "Nothing estimated or made up." },
];

const FAQ = [
  { q: "Is my DPD login safe?", a: "It is encrypted before it is stored, and the connection can only look and download." },
  { q: "I run more than one franchise.", a: `Add them all. £${PRICE} a month covers every franchise on your account.` },
  { q: "What if the figures don't match the invoice?", a: "You see by how much, so you can find the missing or late day." },
  { q: "Is this part of DPD?", a: "No. It is an independent product by Winjo Digital, not affiliated with or endorsed by DPD." },
];

const H2 = "text-balance font-display text-[2rem] font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[2.6rem]";

export default function WelcomePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden className="mk-ruled pointer-events-none absolute inset-x-0 top-0 h-[38rem]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-9 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[minmax(0,11fr)_minmax(0,10fr)] lg:items-center lg:gap-16 lg:pt-20">
            <div>
              <p className="text-sm font-semibold text-accent">For DPD Franchise Owners</p>
              <h1 id="hero-title" className="mt-3 text-balance font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-[3.6rem] xl:text-[4.1rem]">
                DPD Payday, Without the Spreadsheet
              </h1>
              <p className="mt-5 max-w-md text-pretty text-lg leading-relaxed text-ink-soft sm:text-xl">
                We read your DPD portal every night and work out what each driver is owed.
              </p>
              <Link href="/signup" className={`${buttonClass("primary", "lg")} mt-8 h-13 w-full px-7 text-base shadow-[0_10px_24px_-12px_rgb(184_71_0/0.7)] sm:w-auto`}>
                Get Started for £{PRICE} a Month <ArrowRight className="size-4" aria-hidden />
              </Link>
              <p className="mt-4 text-sm text-muted">No set-up fee. Cancel any time.</p>
            </div>
            <HeroPayday className="mx-auto w-full max-w-md lg:mr-0" />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-20 border-y border-line bg-sunken/60">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="how-title" className={H2}>How It Works</h2>
            <p className="mt-3 text-lg text-ink-soft">Connect your DPD login once. The rest happens overnight.</p>
            <div className="mt-10">
              <HowFlow />
            </div>
            <ul className="mt-12 grid gap-6 border-t border-line-strong pt-8 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex gap-3">
                  <Icon className="mt-0.5 size-5 shrink-0 text-good" aria-hidden />
                  <div>
                    <p className="font-semibold">{title}</p>
                    <p className="text-sm text-ink-soft">{text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <h2 id="pricing-title" className={H2}>£{PRICE} a Month. Every Franchise.</h2>
              <p className="mt-3 text-lg text-paper/75">No set-up fee, no contract, cancel any time.</p>
            </div>
            <Link href="/signup" className="inline-flex h-13 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-paper px-7 text-base font-semibold text-ink transition-colors hover:bg-white active:translate-y-px sm:w-auto">
              Get Started <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </section>

        <section id="questions" aria-labelledby="questions-title" className="scroll-mt-20">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="questions-title" className={H2}>Questions</h2>
            <div className="mt-6 divide-y divide-line-strong border-y border-line-strong">
              {FAQ.map((f) => (
                <details key={f.q} name="faq" className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 pr-1 text-left font-semibold transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <Plus className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-45" aria-hidden />
                  </summary>
                  <p className="pb-5 pr-8 text-[0.9375rem] leading-relaxed text-ink-soft">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
