import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, Check, Plus, ShieldCheck } from "lucide-react";
import "@fontsource-variable/source-serif-4";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import { Band, BandHeading, Leader } from "@/components/marketing/primitives";
import { CheckPreview, DriverPayPreview, FranchisesPreview, ReportPreview } from "@/components/marketing/previews";
import { HeroVideo } from "@/components/marketing/hero-video";
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

const BY_HAND = [
  { hand: "Log in to the DPD portal and read off each day's payments.", app: "Your payments, charges and invoices are read every night, for every franchise." },
  { hand: "Copy the figures into a spreadsheet.", app: "Income, DPD charges and your own expenses sit side by side, day by day." },
  { hand: "Work out what each driver is owed.", app: "Each driver's pay is worked out from the rate you set for them." },
  { hand: "Hope the invoice agrees with your sums.", app: "Your figures are checked against DPD's own invoice for the period." },
];

const STEPS = [
  { when: "Once", title: "Connect DPD", text: "Add your DPD portal login once. It is stored encrypted, and the connection is read-only: it can look and download, never change anything in DPD." },
  { when: "Every Night", title: "We Read It Every Night", text: "Your daily payments, charges and invoices come in by themselves, for every franchise on your account." },
  { when: "Monday After Each Period", title: "Payday Is Already Worked Out", text: "See income, expenses and what each driver is owed, day by day, with a report ready the Monday after each four-week period." },
];

const REPORTING_RULES = [
  { title: "Only What DPD States", text: "Franchise Books reads the figures the DPD portal states. It never makes one up, estimates one or corrects one." },
  { title: "Missing Is Not Zero", text: "A day that has not been read is shown as missing, not as £0. A page that states zero is shown as zero." },
  { title: "Checked Against the Invoice", text: "Our daily payments are compared with the figures DPD's own invoice states for the period, and any difference is shown." },
];

const PROTECTIONS = [
  { title: "Read-Only Access", text: "The connection can look and download. It is built so it can never change or submit anything in the DPD portal." },
  { title: "Encrypted Login", text: "Your DPD login is encrypted before it is stored, and only the app can read it." },
  { title: "Verification Codes", text: "If DPD asks for a code, the nightly read stops rather than trying to get round it, and it tells you." },
  { title: "Drivers See Their Own Pay", text: "A driver you invite has their own page, which shows their own days, pay and statements." },
];

const FAQ = [
  { q: "Is my DPD login safe?", a: "It is encrypted before it is stored and only the app can read it. The connection can only look and download. It is built so it can never change or submit anything in the DPD portal." },
  { q: "How many franchises can I add?", a: `As many as you run. The price is per account, not per franchise: £${PRICE} a month.` },
  { q: "What if the figures do not match DPD's invoice?", a: "The Period Check page shows by how much, with the invoice, the charges and your daily payments side by side. A day may be missing or posted late: sync again, then compare with the Payments page." },
  { q: "What if DPD asks for a verification code?", a: "The nightly read stops rather than trying to get round it, and tells you. You can still upload reports by hand." },
  { q: "Do my drivers need an account?", a: "No. If you want them to, you can invite a driver by email so they can see their own days, pay and statements. Their page shows only their own pay." },
  { q: "Is Franchise Books part of DPD?", a: "No. It is an independent product by Winjo Digital. It is not affiliated with or endorsed by DPD." },
  { q: "Can I cancel?", a: "Yes, any time, from the Settings page. You keep access until the end of the period you have paid for." },
];

function ProductRow({ kicker, title, preview, flip = false, children }: { kicker: string; title: string; preview: React.ReactNode; flip?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid items-start gap-8 border-t border-line-strong py-10 first:border-t-0 first:pt-0 last:pb-0 sm:py-12 lg:grid-cols-12 lg:gap-12">
      <div className={cn("lg:col-span-5", flip && "lg:order-2")}>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{kicker}</p>
        <h3 className="mt-2 text-balance text-2xl font-semibold leading-snug tracking-tight">{title}</h3>
        <div className="mt-3 space-y-4 text-[0.9375rem] leading-relaxed text-ink-soft">{children}</div>
      </div>
      <div className={cn("min-w-0 lg:col-span-7", flip && "lg:order-1")}>{preview}</div>
    </div>
  );
}

function FactList({ items }: { items: string[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((t) => (
        <li key={t} className="flex gap-3 py-2.5">
          <Check className="mt-1 size-4 shrink-0 text-good" strokeWidth={2.25} aria-hidden />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export default function WelcomePage() {
  return (
    <div className="min-h-dvh">
      <SiteHeader />

      <main>
        {/* 1. What it does */}
        <section aria-labelledby="hero-title" className="relative overflow-hidden">
          <div aria-hidden className="mk-ruled pointer-events-none absolute inset-x-0 top-0 h-[38rem]" />
          <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-9 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[minmax(0,11fr)_minmax(0,12fr)] lg:items-center lg:gap-16 lg:pt-20">
            <div>
              <p className="text-sm font-semibold text-accent">For DPD Franchise Owners</p>
              <h1 id="hero-title" className="mt-3 text-balance font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.02em] sm:text-6xl lg:text-[3.6rem] xl:text-[4.1rem]">
                Payday, Worked Out Before You Wake Up.
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-ink-soft sm:text-xl sm:leading-relaxed">
                Every night Franchise Books reads your DPD payments and charges, works out what each driver is owed, and checks it all against DPD&rsquo;s invoice. You open it, pay your drivers, and get your evening back.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <Link href="/signup" className={`${buttonClass("primary", "lg")} h-13 w-full px-7 text-base shadow-[0_10px_24px_-12px_rgb(184_71_0/0.7)] sm:w-auto`}>
                  Get Started for £{PRICE} a Month <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href="#how" className="inline-flex items-center justify-center gap-1.5 text-[0.9375rem] font-semibold text-ink underline decoration-line-strong decoration-2 underline-offset-[6px] transition-colors hover:decoration-accent sm:justify-start">
                  See How It Works <ArrowDown className="size-4" aria-hidden />
                </Link>
              </div>
              <p className="mt-6 flex items-start gap-2 text-sm text-muted">
                <ShieldCheck className="mt-px size-4 shrink-0 text-good" aria-hidden />
                Read-only DPD access. No set-up fee. Cancel any time.
              </p>
            </div>

            <div className="relative min-w-0">
              <div aria-hidden className="absolute -inset-x-6 -bottom-6 top-10 hidden -rotate-2 rounded-2xl border border-line-strong/70 bg-sunken/80 lg:block" />
              <HeroPayday className="relative mx-auto max-w-md lg:ml-auto lg:mr-4" />
            </div>
          </div>
        </section>

        {/* 2. The problem it solves */}
        <Band id="problem" folio="01" label="The Problem" tone="surface">
          <BandHeading id="problem" intro="Everything you need is in the DPD portal, spread across daily payments, charges and invoices. Franchise Books gathers it and does the sums.">
            Payday Shouldn&rsquo;t Mean an Evening in the DPD Portal.
          </BandHeading>
          <div className="mt-10 overflow-hidden rounded-lg border border-line-strong">
            <div className="hidden grid-cols-2 border-b border-line-strong bg-sunken/70 text-xs font-semibold uppercase tracking-wider text-muted md:grid">
              <p className="px-5 py-2.5">Doing It by Hand</p>
              <p className="border-l border-line-strong px-5 py-2.5 text-accent">With Franchise Books</p>
            </div>
            <ul className="divide-y divide-line">
              {BY_HAND.map((r) => (
                <li key={r.hand} className="grid md:grid-cols-2">
                  <p className="px-5 pt-4 text-[0.9375rem] text-muted md:py-4"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider md:hidden">By hand</span>{r.hand}</p>
                  <p className="px-5 pb-4 pt-2 text-[0.9375rem] font-medium md:border-l md:border-line-strong md:py-4"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-accent md:hidden">With Franchise Books</span>{r.app}</p>
                </li>
              ))}
            </ul>
          </div>
        </Band>

        {/* 3. How it works */}
        <Band id="how" folio="02" label="How It Works">
          <BandHeading id="how" intro="Three steps, and the last one is done for you every night.">
            Connect Once. After That, It&rsquo;s Done.
          </BandHeading>
          <ol className="mt-10 space-y-0 border-l-2 border-accent/80 pl-6 sm:pl-8 md:ml-2 md:grid md:grid-cols-3 md:gap-8 md:space-y-0 md:border-l-0 md:border-t-2 md:border-accent/80 md:pl-0 md:pt-6">
            {STEPS.map((s) => (
              <li key={s.title} className="relative pb-10 last:pb-0 md:pb-0">
                <span aria-hidden className="absolute -left-[2.05rem] top-1.5 size-3 rounded-full border-2 border-accent bg-paper sm:-left-[2.55rem] md:-top-[1.8rem] md:left-0" />
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">{s.when}</p>
                <h3 className="mt-2 font-display text-[1.35rem] font-semibold leading-snug tracking-tight">{s.title}</h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </Band>

        {/* 4. What the customer can see inside */}
        <Band id="inside" folio="03" label="Inside the Platform" tone="sunken">
          <BandHeading id="inside" intro="These illustrations are simplified from the real screens and use example figures. They are not customer data.">
            See What You Get Before You Sign Up.
          </BandHeading>
          <div className="mx-auto mt-10 max-w-4xl">
            <HeroVideo />
          </div>
          <div className="mt-14 sm:mt-16">
            <ProductRow kicker="Driver Pay" title="Each Driver's Pay, Worked Out From the Rate You Set" preview={<DriverPayPreview />}>
              <p>Pay each driver per day worked or per stop, and see their total before you transfer a penny.</p>
              <FactList items={[
                "Stops, parcels, pay, route and mileage laid out the way the DPD Payments page shows them, so drivers recognise it.",
                "A one-page statement for each driver, for each pay period, that they can download from their own page.",
              ]} />
            </ProductRow>

            <ProductRow kicker="Invoice Check" title="A Missing Day Shows Up Before Payday, Not After" preview={<CheckPreview />} flip>
              <p>Your daily payments are compared with DPD&rsquo;s own invoice for the period. If they agree, it says so. If they don&rsquo;t, you see by how much, so you can look for the day that is missing or posted late.</p>
              <p>DPD charges and your own expenses are set against income, so you can see what the franchise really made.</p>
            </ProductRow>

            <ProductRow kicker="Several Franchises" title="Every Franchise on One Login" preview={<FranchisesPreview />}>
              <p>Add as many FD numbers as you run. Each stays separate, and you can see them together.</p>
              <p>The price is per account, so adding a franchise costs nothing extra.</p>
            </ProductRow>

            <ProductRow kicker="Reports" title="A Report for Each Four-Week Period" preview={<ReportPreview />} flip>
              <p>A clear PDF of earnings, expenses and what drivers are owed, made for each four-week DPD period, so you have something organised to keep, share or hand to your accountant.</p>
              <FactList items={[
                "Income, driver wages, expenses and profit at a glance.",
                "A breakdown for each franchise on your account.",
                "Ready the Monday after each period closes.",
              ]} />
            </ProductRow>
          </div>
        </Band>

        {/* 5. Why the figures can be trusted */}
        <Band id="trust" folio="04" label="Trust" tone="surface">
          <BandHeading id="trust" intro="An accountant or a driver should be able to set our figures beside the portal and find the same numbers.">
            Figures You Can Put Next to the DPD Portal.
          </BandHeading>
          <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <h3 className="border-b border-ink/70 pb-2 text-sm font-semibold uppercase tracking-wider">What We Report</h3>
              <dl className="divide-y divide-line">
                {REPORTING_RULES.map((r) => (
                  <div key={r.title} className="py-4">
                    <dt className="font-semibold">{r.title}</dt>
                    <dd className="mt-1 text-[0.9375rem] leading-relaxed text-ink-soft">{r.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <h3 className="border-b border-ink/70 pb-2 text-sm font-semibold uppercase tracking-wider">How Your Login Is Protected</h3>
              <dl className="divide-y divide-line">
                {PROTECTIONS.map((r) => (
                  <div key={r.title} className="py-4">
                    <dt className="font-semibold">{r.title}</dt>
                    <dd className="mt-1 text-[0.9375rem] leading-relaxed text-ink-soft">{r.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
          <p className="mt-10 border-l-2 border-accent pl-4 text-[0.9375rem] leading-relaxed text-ink-soft">
            Franchise Books is an independent product by Winjo Digital. It is not affiliated with or endorsed by DPD.{" "}
            <Link href="/privacy" className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">Read the Privacy Policy</Link>.
          </p>
        </Band>

        {/* 6. Cost */}
        <Band id="pricing" folio="05" label="Pricing">
          <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <BandHeading id="pricing" intro={`£${PRICE} a month covers your account and every franchise on it. There is no set-up fee, no minimum contract, and no extra charge for adding a franchise.`}>
                One Account. One Price.
              </BandHeading>
              <div className="mt-8 max-w-xl text-[0.9375rem] text-ink-soft">
                <FactList items={[
                  "Nightly sync with the DPD portal, for every franchise.",
                  "Driver pay, expenses and a report for every period.",
                  "Cancel from Settings and keep access until the end of the period you have paid for.",
                ]} />
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-[0_1px_0_rgb(63_28_8/0.04),0_28px_56px_-28px_rgb(63_28_8/0.32)]">
              <div className="h-1 bg-accent-bar" aria-hidden />
              <div className="p-6 sm:p-8">
                <p className="text-sm font-medium text-muted">Franchise Books</p>
                <p className="num mt-1 text-5xl font-semibold tracking-tight">£{PRICE}<span className="ml-2 text-base font-normal text-muted">a month</span></p>
                <dl className="mt-7 space-y-2.5 text-[0.9375rem]">
                  <Leader label="Franchises on your account" value="Every one" />
                  <Leader label="Set-up fee" value="None" />
                  <Leader label="Minimum contract" value="None" />
                  <Leader label="Cancel" value="Any time" />
                </dl>
                <Link href="/signup" className={`${buttonClass("primary", "lg")} mt-8 w-full shadow-sm`}>Get Started</Link>
              </div>
            </div>
          </div>
        </Band>

        {/* 7. Concerns */}
        <Band id="questions" folio="06" label="Questions" tone="surface">
          <BandHeading id="questions">Questions Owners Ask.</BandHeading>
          <div className="mt-8 max-w-3xl divide-y divide-line-strong border-y border-line-strong">
            {FAQ.map((f) => (
              <details key={f.q} name="faq" className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded py-4 pr-1 text-left font-semibold transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Plus className="size-4 shrink-0 text-muted transition-transform duration-200 group-open:rotate-45" aria-hidden />
                </summary>
                <p className="pb-5 pr-8 text-[0.9375rem] leading-relaxed text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </Band>

        {/* 8. Getting started */}
        <section aria-labelledby="cta-title" className="bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
            <div>
              <h2 id="cta-title" className="max-w-2xl text-balance font-display text-[2rem] font-semibold leading-[1.1] tracking-[-0.015em] sm:text-[2.6rem]">Spend Payday on the Business, Not the Spreadsheet.</h2>
              <p className="mt-4 max-w-xl text-lg text-paper/75">Connect DPD once, and your figures are ready every night.</p>
            </div>
            <div className="lg:text-right">
              <Link href="/signup" className="inline-flex h-12 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-paper px-6 text-base font-medium text-ink transition-colors hover:bg-white active:translate-y-px sm:w-auto">
                Get Started for £{PRICE} a Month <ArrowRight className="size-4" aria-hidden />
              </Link>
              <p className="mt-3 text-sm text-paper/65">No set-up fee. No minimum contract. Cancel any time.</p>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
