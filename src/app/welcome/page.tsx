import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import "@fontsource-variable/source-serif-4";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import { HeroDemo } from "@/components/marketing/hero-demo";
import { FeatureTabs } from "@/components/marketing/feature-tabs";
import { PriceSlider } from "@/components/marketing/price-slider";
import { CheckPreview, DriverPayPreview, FranchisesPreview, ReportPreview } from "@/components/marketing/previews";
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

const FAQ = [
  { q: "Is my DPD login safe?", a: "It is encrypted before it is stored, and the connection can only look and download." },
  { q: "I run more than one franchise.", a: `Add them all. £${PRICE} a month covers every franchise on your account.` },
  { q: "What if the figures don't match the invoice?", a: "You see by how much, so you can find the missing or late day." },
  { q: "Is this part of DPD?", a: "No. It is an independent product by Winjo Digital, not affiliated with or endorsed by DPD." },
];

const H2 = "text-balance font-display text-[2rem] font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[2.75rem]";

export default function WelcomePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        <section aria-labelledby="hero-title" className="overflow-hidden bg-[linear-gradient(180deg,#a84000_0%,#c95100_45%,#f06000_100%)] text-white">
          <div className="mx-auto grid max-w-6xl gap-9 px-4 pb-12 pt-7 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
            <div>
              <h1 id="hero-title" className="text-balance font-display text-[2.4rem] font-semibold leading-[1.02] tracking-[-0.02em] sm:text-6xl xl:text-[4.25rem]">
                DPD Payday, <span className="text-white/70">Done Overnight</span>
              </h1>
              <p className="mt-3 max-w-md text-base font-medium text-white/90 sm:mt-5 sm:text-xl">Your drivers&rsquo; pay, worked out from DPD&rsquo;s own figures while you sleep.</p>
              <Link href="/signup" className="mt-6 inline-flex h-12 w-full sm:mt-8 sm:h-13 items-center justify-center gap-2 rounded-lg bg-paper px-7 text-base font-semibold text-ink shadow-[0_14px_30px_-14px_rgb(40_14_0/0.8)] transition-colors hover:bg-white active:translate-y-px sm:w-auto">
                Get Started for £{PRICE} a Month <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            <HeroDemo />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-20">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="how-title" className={H2}>
              Every Screen You Need, <span className="text-muted">Built From Your DPD Figures</span>
            </h2>
            <div className="mt-8">
              <FeatureTabs
                panels={[
                  { label: "Driver Pay", title: "Each Driver's Pay", node: <DriverPayPreview /> },
                  { label: "Invoice Check", title: "Checked Against the Invoice", node: <CheckPreview /> },
                  { label: "Franchises", title: "Every Franchise, One Login", node: <FranchisesPreview /> },
                  { label: "Reports", title: "A Report for Each Period", node: <ReportPreview /> },
                ]}
              />
            </div>
          </div>
        </section>

        <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 bg-ink text-paper">
          <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="pricing-title" className={H2}>
              One Price. <span className="text-paper/55">However Many Franchises You Run.</span>
            </h2>
            <div className="mt-8">
              <PriceSlider price={PRICE} />
            </div>
            <p className="mt-4 text-sm text-paper/65">No set-up fee. No contract. Cancel any time.</p>
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
