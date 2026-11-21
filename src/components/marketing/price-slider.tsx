"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Store } from "lucide-react";

/** Pricing as something to play with: drag the franchise count, watch the price stay the same. */
export function PriceSlider({ price }: { price: number }) {
  const [n, setN] = useState(1);
  return (
    <div className="grid overflow-hidden rounded-2xl border border-white/10 lg:grid-cols-2">
      <div className="bg-white/[0.04] p-6 sm:p-8">
        <label htmlFor="franchise-count" className="flex items-baseline justify-between text-sm font-semibold text-paper/80">
          Franchises you run
          <span className="num font-display text-3xl text-paper">{n === 10 ? "10+" : n}</span>
        </label>
        <input
          id="franchise-count"
          type="range"
          min={1}
          max={10}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="mk-range mt-5 w-full"
        />
        <div aria-hidden className="mt-6 flex min-h-8 flex-wrap gap-2">
          {Array.from({ length: n }, (_, k) => (
            <span key={k} className="mk-pop grid size-8 place-items-center rounded-md bg-white/10 text-paper/90">
              <Store className="size-4" />
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col justify-between gap-8 bg-[linear-gradient(140deg,#f06000,#b84700)] p-6 text-white sm:p-8">
        <div>
          <p className="text-sm font-semibold text-white/80">Your price</p>
          <p className="num mt-1 font-display text-6xl font-semibold tracking-tight">£{price}</p>
          <p className="mt-1 text-white/85">a month, for {n === 1 ? "1 franchise" : n === 10 ? "10 or more" : `${n} franchises`}</p>
        </div>
        <Link href="/signup" className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-paper px-6 font-semibold text-ink transition-colors hover:bg-white active:translate-y-px">
          Get Started <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
