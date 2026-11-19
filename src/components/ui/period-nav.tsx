import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import type { ISODate } from "@/lib/dates";
import { nextPeriodIfStarted, periodLabel, previousPeriod, type DpdPeriod } from "@/lib/finance/periods";

/** Steps through DPD pay periods, labelled with the same dates the DPD portal uses. */
export function PeriodNav({ period, today, hrefFor, exportHref }: { period: DpdPeriod; today: ISODate; hrefFor: (periodStart: ISODate) => string; exportHref?: string }) {
  const next = nextPeriodIfStarted(period, today);
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      <Link href={hrefFor(previousPeriod(period).start)} className={buttonClass("secondary", "sm")} aria-label="Previous pay period"><ChevronLeft className="size-4" aria-hidden /></Link>
      <span className="min-w-48 text-center font-medium">{periodLabel(period)}</span>
      {next ? <Link href={hrefFor(next.start)} className={buttonClass("secondary", "sm")} aria-label="Next pay period"><ChevronRight className="size-4" aria-hidden /></Link> : null}
      {exportHref ? <a className={`${buttonClass("quiet", "sm")} ml-auto`} href={exportHref}>Download Spreadsheet</a> : null}
    </div>
  );
}
