import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ChevronDown, ClipboardCheck, FileText, Layers, Lock, Plug, PoundSterling, RefreshCw, Scale, ShieldCheck, Users } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import Image from "next/image";

export const metadata: Metadata = {
  title: { absolute: "Franchise Books by Winjo Digital: know what your DPD franchise earns and what each driver is owed" },
  description: "Connect your DPD login once. Every night Franchise Books reads your payments and charges, works out each driver's pay, and has a report ready for payday.",
  robots: { index: true, follow: true },
};

const STEPS = [
  { icon: Plug, title: "Connect DPD", text: "Add your DPD portal login once. It is stored encrypted, and the connection is read-only: it can look and download, never change anything in DPD." },
  { icon: RefreshCw, title: "We Read It Every Night", text: "Your daily payments, charges and invoices come in by themselves, for every franchise on your account." },
  { icon: FileText, title: "Payday Is Already Worked Out", text: "See income, expenses and what each driver is owed, day by day, with a report ready the Monday after each four-week period." },
];

const FEATURES = [
  { icon: Users, title: "Every Driver, Every Day", text: "Stops, parcels, pay, route and mileage laid out the way the DPD Payments page shows them, so drivers recognise it." },
  { icon: PoundSterling, title: "Driver Pay Your Way", text: "Pay each driver per day worked or per stop, and see their total before you transfer a penny." },
  { icon: ClipboardCheck, title: "A Check Against DPD's Invoices", text: "Our figures are compared with DPD's own invoice for the period, so a missing day shows up before payday, not after." },
  { icon: Scale, title: "Expenses and Profit", text: "DPD charges and your own expenses are set against income, so you can see what the franchise really made." },
  { icon: Layers, title: "Several Franchises, One Login", text: "Add as many FD numbers as you run. Each stays separate, and you can see them together." },
  { icon: FileText, title: "A Report for Each Period", text: "A clear PDF of earnings, expenses and what drivers are owed, made for each four-week DPD period." },
];

const FAQ = [
  { q: "Is my DPD login safe?", a: "It is encrypted before it is stored and only the app can read it. The connection can only look and download. It is built so it can never change or submit anything in the DPD portal." },
  { q: "How many franchises can I add?", a: `As many as you run. The price is per account, not per franchise: £${PLAN_PRICE_GBP} a month.` },
  { q: "What if DPD asks for a verification code?", a: "The nightly read stops rather than trying to get round it, and tells you. You can still upload reports by hand." },
  { q: "Can I cancel?", a: "Yes, any time, from the Settings page. You keep access until the end of the period you have paid for." },
];

/** An example, clearly labelled, so a visitor can see what they would get. Not real customer figures. */
const EXAMPLE_DRIVERS = [
  { name: "Alex", detail: "18 days", amount: "£1,620.00" },
  { name: "Sam", detail: "14 days", amount: "£1,260.00" },
  { name: "Jo", detail: "6 days", amount: "£280.00" },
];

const CARD_SHADOW = "shadow-[0_1px_2px_rgb(22_25_29/0.05),0_16px_40px_-16px_rgb(22_25_29/0.22)]";

function IconTile({ icon: Icon }: { icon: typeof Plug }) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent" aria-hidden>
      <Icon className="size-5" strokeWidth={1.75} />
    </span>
  );
}

function PeriodSummaryExample() {
  return (
    <figure className={`overflow-hidden rounded-2xl border border-line bg-surface ${CARD_SHADOW}`} aria-label="An example period summary">
      <div className="flex items-center justify-between border-b border-line bg-sunken/60 px-5 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Period summary</p>
          <p className="text-sm font-semibold">Four weeks, Monday to Sunday</p>
        </div>
        <span className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-xs font-medium text-ink-soft">Example</span>
      </div>
      <div className="space-y-3 px-5 py-4 text-[0.9375rem]">
        <div className="flex items-baseline justify-between"><span className="text-ink-soft">Income from DPD</span><span className="num font-medium">£6,480.00</span></div>
        <div className="flex items-baseline justify-between"><span className="text-ink-soft">DPD charges</span><span className="num font-medium text-ink-soft">−£740.00</span></div>
        <div className="flex items-baseline justify-between"><span className="text-ink-soft">Driver pay</span><span className="num font-medium text-ink-soft">−£3,160.00</span></div>
        <div className="flex items-baseline justify-between border-t border-line-strong pt-3">
          <span className="font-semibold">Left for the franchise</span>
          <span className="num text-xl font-semibold tracking-tight">£2,580.00</span>
        </div>
      </div>
      <div className="border-t border-line bg-paper/60 px-5 py-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Owed to drivers on Friday</p>
        <ul className="space-y-1.5 text-[0.9375rem]">
          {EXAMPLE_DRIVERS.map((d) => (
            <li key={d.name} className="flex items-baseline justify-between">
              <span>{d.name} <span className="text-sm text-muted">· {d.detail}</span></span>
              <span className="num font-medium">{d.amount}</span>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="border-t border-line px-5 py-2.5 text-xs text-muted">Example figures, for illustration only.</figcaption>
    </figure>
  );
}

export default function WelcomePage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/welcome" className="flex items-center">
            <Image src="/logo.png" alt="Franchise Books by WINJO Digital" width={629} height={390} className="h-14 w-auto" />
          </Link>
          <nav aria-label="Account" className="flex items-center gap-1.5">
            <Link href="/login" className={buttonClass("quiet", "sm")}>Sign in</Link>
            <Link href="/signup" className={buttonClass("primary", "sm")}>Get started</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(220_0_50/0.07),transparent)]" />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-10 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink-soft">
                <span className="size-1.5 rounded-full bg-accent" aria-hidden /> For DPD franchise owners
              </p>
              <h1 className="mt-5 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
                Know What Your Franchise Earns, and What Each Driver Is Owed.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
                Connect your DPD login once. Every night we read your payments and charges and work out each driver&rsquo;s pay, so payday takes minutes, not an evening.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href="/signup" className={`${buttonClass("primary", "lg")} w-full shadow-sm sm:w-auto`}>
                  Get started for £{PLAN_PRICE_GBP} a month <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link href="#how" className={`${buttonClass("secondary", "lg")} w-full sm:w-auto`}>See how it works</Link>
              </div>
              <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-soft" aria-label="Why it is safe to try">
                <li className="inline-flex items-center gap-1.5"><ShieldCheck className="size-4 text-good" aria-hidden /> Read-only access</li>
                <li className="inline-flex items-center gap-1.5"><Lock className="size-4 text-good" aria-hidden /> Encrypted login</li>
                <li className="inline-flex items-center gap-1.5"><Check className="size-4 text-good" aria-hidden /> Cancel any time</li>
              </ul>
            </div>
            <PeriodSummaryExample />
          </div>
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-16 border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="how-title" className="text-3xl font-semibold tracking-tight">How It Works</h2>
            <p className="mt-2 max-w-xl text-ink-soft">Three steps, and the last one is done for you every night.</p>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative rounded-2xl border border-line bg-paper/60 p-6">
                  <div className="flex items-center justify-between">
                    <IconTile icon={s.icon} />
                    <span className="num text-sm font-medium text-muted">Step {i + 1}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.title}</h3>
                  <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-soft">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="features-title" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 id="features-title" className="max-w-2xl text-3xl font-semibold tracking-tight">Built Around How DPD Franchises Actually Work</h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-line-strong">
                <IconTile icon={f.icon} />
                <h3 className="mt-4 font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-soft">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="price-title" className="border-y border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 id="price-title" className="text-3xl font-semibold tracking-tight">One Simple Price</h2>
              <p className="mt-3 max-w-md text-ink-soft">One account, however many franchises you run. No set-up fee, no contract, and no extra charge for adding a franchise.</p>
            </div>
            <div className={`overflow-hidden rounded-2xl border border-line bg-paper ${CARD_SHADOW}`}>
              <div className="h-1 bg-accent" aria-hidden />
              <div className="p-6 sm:p-8">
                <p className="text-sm font-medium text-muted">Per account</p>
                <p className="mt-1 text-5xl font-semibold tracking-tight">£{PLAN_PRICE_GBP}<span className="ml-1 text-lg font-normal text-muted">a month</span></p>
                <ul className="mt-6 space-y-3 text-[0.9375rem]">
                  {["Every franchise on your account", "Nightly sync with the DPD portal", "Driver pay, expenses and a report for every period", "Cancel any time"].map((t) => (
                    <li key={t} className="flex items-start gap-3">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-good-soft text-good" aria-hidden><Check className="size-3.5" strokeWidth={2.5} /></span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/signup" className={`${buttonClass("primary", "lg")} mt-8 w-full shadow-sm`}>Get started</Link>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 id="faq-title" className="text-3xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <p className="pb-4 text-[0.9375rem] leading-relaxed text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="cta-title" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="rounded-3xl bg-ink px-6 py-12 text-center text-white sm:px-12 sm:py-16">
            <h2 id="cta-title" className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Spend Payday on the Business, Not the Spreadsheet.</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/70">Connect DPD once, and your figures are ready every night.</p>
            <Link href="/signup" className={`${buttonClass("primary", "lg")} mt-8 w-full sm:w-auto`}>Get started for £{PLAN_PRICE_GBP} a month <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="font-medium text-ink-soft">Franchise Books <span className="font-normal text-muted">by Winjo Digital</span></p>
            <p className="mt-1">An independent product. It is not affiliated with or endorsed by DPD.</p>
          </div>
          <nav aria-label="Footer" className="flex gap-5">
            <Link href="/login" className="underline-offset-2 hover:text-ink hover:underline">Sign in</Link>
            <Link href="/signup" className="underline-offset-2 hover:text-ink hover:underline">Get started</Link>
            <Link href="/privacy" className="underline-offset-2 hover:text-ink hover:underline">Privacy</Link>
            <Link href="/terms" className="underline-offset-2 hover:text-ink hover:underline">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
