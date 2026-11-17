import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

/**
 * One "Add" control instead of three header buttons: entering data is occasional, reading the figures is daily.
 * A plain <details> element, so it needs no script and works the same on a phone.
 */
export function AddMenu() {
  const items = [
    { href: "/expenses?add=1", label: "Expense", hint: "Fuel, repairs, anything you paid" },
    { href: "/adjustments/new", label: "Pay adjustment", hint: "Add to or deduct from a driver's pay" },
    { href: "/adjustments/cover", label: "Driver cover", hint: "Record who covered a route" },
  ];
  return (
    <details className="group relative">
      <summary className={`${buttonClass("primary")} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <Plus className="size-4" aria-hidden />
        Add
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-lg">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="block border-b border-line px-4 py-3 last:border-0 hover:bg-sunken">
            <span className="block font-medium">{item.label}</span>
            <span className="block text-sm text-muted">{item.hint}</span>
          </Link>
        ))}
      </div>
    </details>
  );
}
