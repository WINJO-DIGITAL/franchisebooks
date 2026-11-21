"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";

const TAB_MS = 5000;

/** The product's screens, one at a time. Cycles on its own until the visitor picks one. */
export function FeatureTabs({ panels }: { panels: { label: string; title: string; node: ReactNode }[] }) {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setI((n) => (n + 1) % panels.length), TAB_MS);
    return () => clearTimeout(t);
  }, [auto, visible, i, panels.length]);

  return (
    <div ref={root}>
      <div role="tablist" aria-label="Screens" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {panels.map((p, n) => (
          <button
            key={p.label}
            type="button"
            role="tab"
            aria-selected={i === n}
            onClick={() => { setAuto(false); setI(n); }}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              i === n ? "border-ink bg-ink text-paper" : "border-line-strong bg-surface text-ink-soft hover:border-ink/40 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid">
        {panels.map((p, n) => (
          <div
            key={p.label}
            role="tabpanel"
            aria-hidden={i !== n}
            className={cn("[grid-area:1/1] transition-all duration-500 ease-out", i === n ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0")}
          >
            <p className="mb-3 font-display text-xl font-semibold">{p.title}</p>
            {p.node}
          </div>
        ))}
      </div>
    </div>
  );
}
