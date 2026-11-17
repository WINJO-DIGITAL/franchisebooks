/** A calm placeholder shown while a page loads. Announced politely to screen readers. */
export function LoadingView({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <div className="animate-pulse" aria-hidden>
        <div className="h-7 w-48 rounded bg-sunken" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-sunken" />
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-[var(--radius-card)] border border-line bg-surface" />
          ))}
        </div>
        <div className="mt-6 h-64 rounded-[var(--radius-card)] border border-line bg-surface" />
      </div>
    </div>
  );
}
