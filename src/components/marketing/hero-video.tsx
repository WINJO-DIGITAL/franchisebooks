"use client";

import { useEffect, useRef } from "react";

/**
 * The homepage hero: a short recording of the app on example data, playing on a loop. It plays only when the visitor has
 * not asked for reduced motion; otherwise the still poster is shown. Muted, so it can start on a phone without a tap.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      video.removeAttribute("autoplay");
      video.pause();
      return;
    }
    video.play().catch(() => undefined);
  }, []);
  return (
    <figure className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-lg">
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken/70 px-4 py-2.5" aria-hidden>
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="ml-3 text-xs text-muted">Franchise Books · Example Data</span>
      </div>
      <video
        ref={ref}
        className="block aspect-[1152/684] w-full bg-paper"
        poster="/hero-demo-poster.jpg"
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-label="A short walkthrough of Franchise Books: the dashboard, drivers, income, reports and insights, using example data."
      >
        <source src="/hero-demo.webm" type="video/webm" />
        <source src="/hero-demo.mp4" type="video/mp4" />
      </video>
    </figure>
  );
}
