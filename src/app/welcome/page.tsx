import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { PLAN_PRICE_GBP } from "@/lib/billing/status";
import { brandInitials } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: "Franchise Books by Winjo Digital: know what your DPD franchise earns and what each driver is owed" },
  description: "Connect your DPD login once. Every night Franchise Books reads your payments and charges, works out each driver's pay, and has a report ready for payday.",
  robots: { index: true, follow: true },
};

const STEPS = [
  { title: "Connect DPD", text: "Add your DPD portal login once. It is stored encrypted, and the connection is read-only: it can look and download, never change anything in DPD." },
  { title: "We read it every night", text: "Your daily payments, charges and invoices come in by themselves, for every franchise on your account." },
  { title: "Payday is already worked out", text: "See income, expenses and what each driver is owed, day by day, with a report ready the Monday after each four-week period." },
];

const FEATURES = [
  { title: "Every driver, every day", text: "Stops, parcels, pay, route and mileage laid out the way the DPD Payments page shows them, so drivers recognise it." },
  { title: "Driver pay your way", text: "Pay each driver per day worked or per stop, and see their total before you transfer a penny." },
  { title: "A check against DPD's invoices", text: "Our figures are compared with DPD's own invoice for the period, so a missing day shows up before payday, not after." },
  { title: "Expenses and profit", text: "DPD charges and your own expenses are set against income, so you can see what the franchise really made." },
  { title: "Several franchises, one login", text: "Add as many FD numbers as you run. Each stays separate, and you can see them together." },
  { title: "A report for each period", text: "A clear PDF of earnings, expenses and what drivers are owed, made for each four-week DPD period." },
];

const FAQ = [
  { q: "Is my DPD login safe?", a: "It is encrypted before it is stored and only the app can read it. The connection can only look and download. It is built so it can never change or submit anything in the DPD portal." },
  { q: "How many franchises can I add?", a: `As many as you run. The price is per account, not per franchise: £${PLAN_PRICE_GBP} a month.` },
  { q: "What if DPD asks for a verification code?", a: "The nightly read stops rather than trying to get round it, and tells you. You can still upload reports by hand." },
  { q: "Can I cancel?", a: "Yes, any time, from the Settings page. You keep access until the end of the period you have paid for." },
];

export default function WelcomePage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link href="/welcome" className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-accent text-sm font-semibold tracking-tight text-white" aria-hidden>{brandInitials()}</span>
          <span className="text-base font-semibold">Franchise Books</span>
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("quiet", "sm")}>Sign in</Link>
          <Link href="/signup" className={buttonClass("primary", "sm")}>Get started</Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-16">
          <p className="text-sm font-medium text-accent">For DPD franchise owners</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">Know what your DPD franchise earns, and what each driver is owed.</h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-soft">Connect your DPD login once. Every night we read your payments and charges and work out each driver&rsquo;s pay, so payday takes minutes, not an evening.</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/signup" className={buttonClass("primary", "lg")}>Get started for £{PLAN_PRICE_GBP} a month</Link>
            <Link href="/login" className={buttonClass("secondary", "lg")}>Sign in</Link>
          </div>
          <p className="mt-3 text-sm text-muted">One price per account, however many franchises you run. Cancel any time.</p>
        </section>

        <section aria-labelledby="how" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="how" className="text-2xl font-semibold tracking-tight">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="grid size-8 place-items-center rounded-full bg-accent text-sm font-semibold text-white" aria-hidden>{i + 1}</span>
                  <h3 className="mt-3 font-semibold">{s.title}</h3>
                  <p className="mt-1 text-[0.9375rem] text-ink-soft">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="features" className="text-2xl font-semibold tracking-tight">Built around how DPD franchises actually work</h2>
          <ul className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title}>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-[0.9375rem] text-ink-soft">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="price" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
            <h2 id="price" className="text-2xl font-semibold tracking-tight">Simple pricing</h2>
            <div className="mt-6 max-w-md rounded-xl border border-line bg-paper p-6">
              <p className="text-4xl font-semibold tracking-tight">£{PLAN_PRICE_GBP}<span className="text-base font-normal text-muted"> a month</span></p>
              <p className="mt-1 text-sm text-muted">per account</p>
              <ul className="mt-4 space-y-2 text-[0.9375rem] text-ink-soft">
                <li>Every franchise on your account</li>
                <li>Nightly sync with the DPD portal</li>
                <li>Driver pay, expenses and a report for every period</li>
                <li>Cancel any time</li>
              </ul>
              <Link href="/signup" className={`${buttonClass("primary", "md")} mt-6 w-full`}>Get started</Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="faq" className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 id="faq" className="text-2xl font-semibold tracking-tight">Questions</h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="font-semibold">{f.q}</dt>
                <dd className="mt-1 text-[0.9375rem] text-ink-soft">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <p>Franchise Books by Winjo Digital is an independent product. It is not affiliated with or endorsed by DPD.</p>
          <Link href="/login" className="underline-offset-2 hover:underline">Sign in</Link>
        </div>
      </footer>
    </div>
  );
}
