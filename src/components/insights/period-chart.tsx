import { formatGBP, type Pence } from "@/lib/money";

export interface ChartBar {
  key: string;
  /** Short label under the bar, such as "Oct 26". */
  label: string;
  /** Pence. Null when the period has not been read: no bar is drawn, and a small marker says so. */
  value: Pence | null;
  /** Full description for the tooltip and screen readers. */
  description: string;
}

const SLOT = 32;
const BAR = 20;
const PLOT = 160;
const TOP = 22;
const LEFT = 52;
/** Room on the right for the value label on the last bar. */
const RIGHT = 44;
const AXIS = 30;

/** Rounds up to a clean number of pounds (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8 or 10 × a power of ten), so the tallest bar fills most of the plot. */
function niceMax(pence: number): number {
  const pounds = Math.max(1, Math.ceil(pence / 100));
  const power = 10 ** Math.floor(Math.log10(pounds));
  const step = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * power).find((v) => v >= pounds) ?? 10 * power;
  return Math.round(step * 100);
}

function tick(pence: number): string {
  const pounds = pence / 100;
  if (pounds < 10_000) return `£${pounds.toLocaleString("en-GB")}`;
  const thousands = pounds / 1000;
  return `£${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
}

/** Rounded at the data end (4px), square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

/**
 * A single-series column chart of a pence figure per period, oldest on the left. The table beside it carries every value.
 * `highlightKey` is the one bar whose value is printed on it; the axis, tooltips and table carry the rest.
 */
export function PeriodChart({ bars, title, highlightKey }: { bars: ChartBar[]; title: string; highlightKey?: string }) {
  const values = bars.map((b) => b.value).filter((v): v is number => v != null);
  const max = niceMax(Math.max(0, ...values));
  const width = LEFT + bars.length * SLOT + RIGHT;
  const height = TOP + PLOT + AXIS;
  const y = (v: number) => TOP + PLOT - (v / max) * PLOT;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8));
  const labelled = highlightKey ? bars.findIndex((b) => b.key === highlightKey) : bars.reduce((last, b, i) => (b.value != null && b.value > 0 ? i : last), -1);

  return (
    // Right-to-left scrolling so a narrow screen opens on the newest periods; the chart itself reads left to right.
    <div dir="rtl" className="overflow-x-auto">
      <svg style={{ direction: "ltr" }} role="group" aria-label={title} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-none">
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={LEFT} x2={width - RIGHT + 8} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={LEFT - 8} y={y(v) + 4} textAnchor="end" className="num" fontSize={11} fill="var(--color-muted)">{tick(v)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = LEFT + i * SLOT + (SLOT - BAR) / 2;
          const h = b.value != null ? (b.value / max) * PLOT : 0;
          return (
            <g key={b.key} tabIndex={0} aria-label={b.description} className="outline-none [&:focus-visible>rect]:fill-[var(--color-accent-soft)] [&:hover>rect]:fill-[var(--color-accent-soft)]">
              <title>{b.description}</title>
              {/* Hit area: the whole slot, so the bar is easy to hover or focus. */}
              <rect x={LEFT + i * SLOT} y={TOP} width={SLOT} height={PLOT} fill="transparent" />
              {b.value == null ? (
                <circle cx={x + BAR / 2} cy={TOP + PLOT - 4} r={2.5} fill="var(--color-line-strong)" />
              ) : h > 0 ? (
                <path d={barPath(x, TOP + PLOT - h, BAR, h)} fill="var(--color-accent)" />
              ) : null}
              {i === labelled && b.value != null ? (
                <text x={x + BAR / 2} y={TOP + PLOT - h - 6} textAnchor="middle" className="num" fontSize={11} fontWeight={600} fill="var(--color-ink)">{formatGBP(b.value)}</text>
              ) : null}
              {i % labelEvery === 0 || i === bars.length - 1 ? (
                <text x={x + BAR / 2} y={TOP + PLOT + 18} textAnchor="middle" fontSize={11} fill="var(--color-muted)">{b.label}</text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
