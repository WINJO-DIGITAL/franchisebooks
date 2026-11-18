import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/bits";
import { buttonClass } from "@/components/ui/button";
import type { SetupStep } from "@/lib/onboarding/steps";

/** What is still left to set up. Shows only the steps still to do, and nothing once the account is fully set up. */
export function GettingStarted({ steps }: { steps: SetupStep[] }) {
  if (steps.length === 0) return null;
  return (
    <section aria-labelledby="getting-started" className="mb-8">
      <Panel className="border-accent/25 bg-gradient-to-br from-accent-soft/60 to-surface">
        <h2 id="getting-started" className="text-base font-semibold">{steps.length === 1 ? "One step left to set up" : `${steps.length} steps left to set up`}</h2>
        <p className="mt-0.5 text-sm text-muted">Your figures fill in as these are done.</p>
        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={s.key} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-white" aria-hidden>{i + 1}</span>
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-ink-soft">{s.detail}</p>
                </div>
              </div>
              <Link href={s.href} className={`${buttonClass(i === 0 ? "primary" : "secondary", "sm")} shrink-0`}>
                {s.cta} <ArrowRight className="size-4" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      </Panel>
    </section>
  );
}
