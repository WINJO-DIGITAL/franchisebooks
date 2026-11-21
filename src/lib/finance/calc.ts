/**
 * Central accounting logic.
 *
 * Every financial figure shown anywhere in the application (dashboard, driver
 * pages, monthly reports, PDFs, exports) is produced by the functions in this
 * file. They are pure: they take rows and return totals, with no database or
 * network access, so they can be tested exhaustively on their own.
 *
 * The formulas (see docs/FINANCE.md):
 *
 *   Original earnings   = net earnings supplied by DPD, or
 *                         gross − DPD deductions + DPD additional payments
 *   Adjusted driver pay = original earnings + additional payments − deductions
 *                         (manual pay adjustments; cover allocations are adjustments)
 *   Operating costs     = adjusted driver pay + fuel + other expenses
 *   Operating profit    = verified franchise revenue − operating costs
 *
 * Revenue is NEVER inferred from driver earnings. If no revenue has been
 * entered for a period, profit is reported as unavailable rather than guessed.
 */

import type { ISODate } from "@/lib/dates";
import { allocateProportionally, percentOf, perUnit, sumPence, type Pence } from "@/lib/money";
import { wageForDriver, type DayRate } from "./wages";

// ── Inputs ──────────────────────────────────────────────────────────────────

export interface EarningRow {
  id: string;
  franchiseId: string;
  /** Null until the imported row has been matched to a registered driver. */
  driverId: string | null;
  driverKey: string;
  sourceDriverName: string;
  date: ISODate;
  parcels: number | null;
  stops: number | null;
  gross: Pence;
  deductions: Pence;
  additional: Pence;
  /** Net earnings exactly as DPD stated them, when the document gives a net figure. */
  netSupplied: Pence | null;
}

export type AdjustmentType =
  | "additional_payment"
  | "deduction"
  | "withheld_payment"
  | "earnings_correction"
  | "cover_payment"
  | "other";

export interface AdjustmentRow {
  id: string;
  franchiseId: string;
  driverId: string;
  date: ISODate;
  type: AdjustmentType;
  /** Signed effect on pay in pence. */
  amount: Pence;
  reversesId: string | null;
  coverRecordId: string | null;
}

export type CostAllocation =
  | { scope: "driver"; driverId: string }
  | { scope: "franchise" }
  | { scope: "unallocated" };

export interface CostRow {
  id: string;
  kind: "fuel" | "expense";
  /** Null when the cost has not been assigned to a franchise yet. */
  franchiseId: string | null;
  date: ISODate;
  amount: Pence;
  /** Category of an expense. Fuel-card transactions always count as fuel. */
  categoryId: string | null;
  categoryName: string;
  categoryKind: "fuel" | "vehicle" | "other";
  allocation: CostAllocation;
}

export interface CoverRow {
  id: string;
  franchiseId: string;
  date: ISODate;
  originalDriverId: string;
  coveringDriverId: string;
  expenseAttribution: "original" | "covering" | "franchise";
  status: "active" | "cancelled";
}

export interface RevenueRow {
  id: string;
  franchiseId: string;
  periodStart: ISODate;
  periodEnd: ISODate;
  amount: Pence;
  status: "confirmed" | "estimated";
}

export type RevenueAllocationBasis = "none" | "stops" | "parcels" | "earnings";

/** An extra amount DPD pays the franchise on its self-billed invoice (Fuel Supplement, C&D App ...). Income, never a cost. */
export interface OtherPaymentRow {
  id: string;
  franchiseId: string;
  /** Start of the invoice's billing period, so it lands in the period it belongs to; for a one-off support payment, its invoice date. */
  date: ISODate;
  /** What it is, for example "Fuel Supplement". */
  label: string;
  /** Excluding VAT. */
  amount: Pence;
  /** VAT DPD paid on it, for display only (income is counted excluding VAT). Set for one-off support payments. */
  vat?: Pence;
  invoiceNo: string;
}

export interface PeriodInput {
  from: ISODate;
  to: ISODate;
  earnings: EarningRow[];
  adjustments: AdjustmentRow[];
  costs: CostRow[];
  covers: CoverRow[];
  revenue: RevenueRow[];
  /** Display names for registered drivers. */
  driverNames: Map<string, string>;
  revenueAllocationBasis: RevenueAllocationBasis;
  /**
   * What the imported DPD figures mean. "driver_pay" (the original behaviour): they are what drivers
   * are paid, a cost. "route_income": they are what DPD pays the franchise for each route and day,
   * so they count as income, and driver wages come from day rates.
   */
  earningsMeaning?: EarningsMeaning;
  /** Day rates, used to work out wages when earningsMeaning is "route_income". */
  dayRates?: DayRate[];
  /** The days each driver worked just before the period, so a run of days in a row can carry into it (only read when a rate needs it). */
  workedBefore?: Map<string, ISODate[]>;
  /** Extra DPD payments from invoices; counted as income in "route_income" mode only. */
  otherPayments?: OtherPaymentRow[];
}

export type EarningsMeaning = "driver_pay" | "route_income";

// ── Outputs ─────────────────────────────────────────────────────────────────

export type FigureStatus = "confirmed" | "estimated" | "unavailable";

export interface DriverSummary {
  /** Stable key: the driver id, or "unregistered:<driverKey>" for unmatched report rows. */
  key: string;
  driverId: string | null;
  name: string;
  registered: boolean;
  franchiseId: string;
  daysWorked: number;
  parcels: number;
  stops: number;
  /** True when at least one report row had no parcel / stop count. */
  parcelsIncomplete: boolean;
  stopsIncomplete: boolean;
  originalEarnings: Pence;
  additionalPayments: Pence;
  deductions: Pence;
  adjustmentsNet: Pence;
  finalEarnings: Pence;
  fuel: Pence;
  otherExpenses: Pence;
  /** Revenue allocated to the driver by the configured basis. Null when not available. */
  allocatedRevenue: Pence | null;
  /** allocatedRevenue − finalEarnings − fuel − otherExpenses. Null when revenue is not available. */
  contribution: Pence | null;
  contributionStatus: FigureStatus;
  earningsPerParcel: Pence | null;
  earningsPerStop: Pence | null;
  /** Parcels per stop ×100 (e.g. 137 = 1.37). */
  parcelsPerStopX100: number | null;
  avgEarningsPerDay: Pence | null;
  avgStopsPerDayX10: number | null;
  avgParcelsPerDayX10: number | null;
  /** Wage for the period: day rate × days worked, plus manual adjustments. Equals finalEarnings in "driver_pay" mode. */
  wage: Pence | null;
  /** False when a worked day has no day rate in force, so the wage is incomplete. */
  wageComplete: boolean;
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  kind: "fuel" | "vehicle" | "other";
  total: Pence;
  /** VAT stated on this category's costs. Set on reports; absent on the raw totals. */
  vat?: Pence;
  allocatedToDrivers: Pence;
  franchiseGeneral: Pence;
  unallocated: Pence;
}

export interface FranchiseSummary {
  /** Null groups costs that are not assigned to any franchise yet. */
  franchiseId: string | null;
  revenueConfirmed: Pence;
  revenueEstimated: Pence;
  revenueTotal: Pence;
  revenueStatus: FigureStatus;
  driverOriginalEarnings: Pence;
  driverAdditionalPayments: Pence;
  driverDeductions: Pence;
  driverAdjustmentsNet: Pence;
  driverCosts: Pence;
  fuel: Pence;
  otherExpenses: Pence;
  unallocatedCosts: Pence;
  operatingCosts: Pence;
  operatingProfit: Pence | null;
  profitStatus: FigureStatus;
  /** Profit margin as a percentage with one decimal place. */
  marginPercent: number | null;
  earningsMeaning: EarningsMeaning;
  /** DPD route income counted as revenue ("route_income" mode only; 0 otherwise). */
  incomeFromDpd: Pence;
  /** Part of incomeFromDpd that is extra invoice lines (Fuel Supplement, C&D App ...), not stop pay. */
  otherDpdPayments: Pence;
  /** Driver wages (day rates) plus manual adjustments. Equals driverCosts. */
  wages: Pence;
  /** False when some worked day has no day rate, so wages (and profit) are incomplete. */
  wagesComplete: boolean;
  /** Number of drivers with worked days but no complete day rate. */
  driversMissingRate: number;
  /** Revenue less fuel and other expenses, before driver wages. Null when revenue is unavailable. */
  profitBeforeWages: Pence | null;
  parcels: number;
  stops: number;
  driverCount: number;
  drivers: DriverSummary[];
  categories: CategoryTotal[];
}

export interface PeriodSummary {
  from: ISODate;
  to: ISODate;
  franchises: FranchiseSummary[];
  /** All franchises combined (franchiseId is null on the combined row). */
  combined: FranchiseSummary;
}

// ── Building blocks ─────────────────────────────────────────────────────────

/** The figure treated as the driver's original DPD earnings for one report row. */
export function originalEarnings(row: Pick<EarningRow, "gross" | "deductions" | "additional" | "netSupplied">): Pence {
  return row.netSupplied ?? row.gross - row.deductions + row.additional;
}

/**
 * Checks a report row's own arithmetic. Returns the difference (in pence)
 * between the net DPD stated and gross − deductions + additional, or null
 * when DPD did not state a net figure.
 */
export function netDiscrepancy(row: Pick<EarningRow, "gross" | "deductions" | "additional" | "netSupplied">): Pence | null {
  if (row.netSupplied == null) return null;
  return row.netSupplied - (row.gross - row.deductions + row.additional);
}

export interface AdjustmentTotals {
  additionalPayments: Pence;
  deductions: Pence;
  net: Pence;
}

/**
 * Totals a set of adjustments. An entry and the entry that reverses it cancel
 * exactly, so neither is counted towards "additional payments" or
 * "deductions": the totals show what actually stands.
 */
export function totalAdjustments(rows: AdjustmentRow[]): AdjustmentTotals {
  const reversedIds = new Set(rows.filter((r) => r.reversesId).map((r) => r.reversesId as string));
  let additional = 0;
  let deductions = 0;
  let net = 0;
  for (const row of rows) {
    net += row.amount;
    if (row.reversesId || reversedIds.has(row.id)) continue;
    if (row.amount > 0) additional += row.amount;
    else if (row.amount < 0) deductions += -row.amount;
  }
  return { additionalPayments: additional, deductions, net };
}

/** Adjusted driver pay = original + additional payments − deductions. */
export function adjustedPay(original: Pence, adjustments: AdjustmentTotals): Pence {
  return original + adjustments.net;
}

/**
 * Applies driver-cover rules to cost attribution. If the owner said that the
 * day's costs follow the covering driver (or the franchise), a cost recorded
 * against the original driver on the cover date is re-attributed accordingly.
 * The stored allocation is untouched; this only affects reporting.
 */
export function effectiveAllocation(cost: CostRow, covers: CoverRow[]): CostAllocation {
  if (cost.allocation.scope !== "driver") return cost.allocation;
  const driverId = cost.allocation.driverId;
  const cover = covers.find(
    (c) =>
      c.status === "active" &&
      c.date === cost.date &&
      c.originalDriverId === driverId &&
      (cost.franchiseId == null || c.franchiseId === cost.franchiseId) &&
      c.expenseAttribution !== "original",
  );
  if (!cover) return cost.allocation;
  return cover.expenseAttribution === "covering"
    ? { scope: "driver", driverId: cover.coveringDriverId }
    : { scope: "franchise" };
}

function isFuel(cost: CostRow): boolean {
  return cost.kind === "fuel" || cost.categoryKind === "fuel";
}

function inRange(date: ISODate, from: ISODate, to: ISODate): boolean {
  return date >= from && date <= to;
}

function statusOfRevenue(entries: RevenueRow[]): FigureStatus {
  if (entries.length === 0) return "unavailable";
  return entries.some((r) => r.status === "estimated") ? "estimated" : "confirmed";
}

// ── Period summary ──────────────────────────────────────────────────────────

interface DriverAccumulator {
  key: string;
  driverId: string | null;
  name: string;
  franchiseId: string;
  dates: Set<ISODate>;
  /** Stops per worked day, summed across routes; null if any route that day had no stop count. */
  stopsByDate: Map<ISODate, number | null>;
  parcels: number;
  stops: number;
  parcelsIncomplete: boolean;
  stopsIncomplete: boolean;
  original: Pence;
  adjustments: AdjustmentRow[];
  fuel: Pence;
  other: Pence;
}

function driverKeyFor(driverId: string | null, driverKey: string): string {
  return driverId ?? `unregistered:${driverKey}`;
}

export function summarisePeriod(input: PeriodInput): PeriodSummary {
  const { from, to } = input;
  const earnings = input.earnings.filter((e) => inRange(e.date, from, to));
  const adjustments = input.adjustments.filter((a) => inRange(a.date, from, to));
  const costs = input.costs.filter((c) => inRange(c.date, from, to));
  // A revenue entry counts in the period that contains its start date
  // (entries are constrained to sit inside a single calendar month).
  const revenue = input.revenue.filter((r) => inRange(r.periodStart, from, to));

  const franchiseIds = new Set<string | null>();
  for (const e of earnings) franchiseIds.add(e.franchiseId);
  for (const a of adjustments) franchiseIds.add(a.franchiseId);
  for (const c of costs) franchiseIds.add(c.franchiseId);
  for (const r of revenue) franchiseIds.add(r.franchiseId);
  const otherPayments = (input.otherPayments ?? []).filter((o) => inRange(o.date, from, to));
  if (input.earningsMeaning === "route_income") for (const o of otherPayments) franchiseIds.add(o.franchiseId);

  const franchises: FranchiseSummary[] = [];
  for (const franchiseId of franchiseIds) {
    franchises.push(
      summariseFranchise(
        franchiseId,
        earnings.filter((e) => e.franchiseId === franchiseId),
        adjustments.filter((a) => a.franchiseId === franchiseId),
        costs.filter((c) => c.franchiseId === franchiseId),
        revenue.filter((r) => r.franchiseId === franchiseId),
        input,
        otherPayments.filter((o) => o.franchiseId === franchiseId),
      ),
    );
  }
  franchises.sort((a, b) => (a.franchiseId ?? "~").localeCompare(b.franchiseId ?? "~"));

  return { from, to, franchises, combined: combineFranchises(franchises) };
}

function summariseFranchise(
  franchiseId: string | null,
  earnings: EarningRow[],
  adjustments: AdjustmentRow[],
  costs: CostRow[],
  revenue: RevenueRow[],
  input: PeriodInput,
  otherPayments: OtherPaymentRow[] = [],
): FranchiseSummary {
  const drivers = new Map<string, DriverAccumulator>();
  const ensure = (driverId: string | null, driverKey: string, name: string): DriverAccumulator => {
    const key = driverKeyFor(driverId, driverKey);
    let acc = drivers.get(key);
    if (!acc) {
      acc = {
        key,
        driverId,
        name: driverId ? (input.driverNames.get(driverId) ?? name) : name,
        franchiseId: franchiseId ?? "",
        dates: new Set(),
        stopsByDate: new Map(),
        parcels: 0,
        stops: 0,
        parcelsIncomplete: false,
        stopsIncomplete: false,
        original: 0,
        adjustments: [],
        fuel: 0,
        other: 0,
      };
      drivers.set(key, acc);
    }
    return acc;
  };

  for (const e of earnings) {
    const acc = ensure(e.driverId, e.driverKey, e.sourceDriverName);
    acc.dates.add(e.date);
    const prevStops = acc.stopsByDate.get(e.date);
    acc.stopsByDate.set(e.date, e.stops == null || prevStops === null ? null : (prevStops ?? 0) + e.stops);
    if (e.parcels == null) acc.parcelsIncomplete = true;
    else acc.parcels += e.parcels;
    if (e.stops == null) acc.stopsIncomplete = true;
    else acc.stops += e.stops;
    acc.original += originalEarnings(e);
  }
  for (const a of adjustments) {
    ensure(a.driverId, a.driverId, input.driverNames.get(a.driverId) ?? "Unknown driver").adjustments.push(a);
  }

  // Costs: every cost is counted exactly once, in exactly one bucket.
  const categories = new Map<string, CategoryTotal>();
  let fuelTotal = 0;
  let otherTotal = 0;
  let unallocated = 0;
  for (const cost of costs) {
    const fuel = isFuel(cost);
    const catKey = fuel ? "__fuel__" : (cost.categoryId ?? `name:${cost.categoryName}`);
    let cat = categories.get(catKey);
    if (!cat) {
      cat = {
        categoryId: fuel ? null : cost.categoryId,
        name: fuel ? "Fuel" : cost.categoryName,
        kind: fuel ? "fuel" : cost.categoryKind,
        total: 0,
        allocatedToDrivers: 0,
        franchiseGeneral: 0,
        unallocated: 0,
      };
      categories.set(catKey, cat);
    }
    cat.total += cost.amount;
    if (fuel) fuelTotal += cost.amount;
    else otherTotal += cost.amount;

    const allocation = effectiveAllocation(cost, input.covers);
    if (allocation.scope === "driver") {
      const acc = ensure(allocation.driverId, allocation.driverId, input.driverNames.get(allocation.driverId) ?? "Unknown driver");
      if (fuel) acc.fuel += cost.amount;
      else acc.other += cost.amount;
      cat.allocatedToDrivers += cost.amount;
    } else if (allocation.scope === "franchise") {
      cat.franchiseGeneral += cost.amount;
    } else {
      cat.unallocated += cost.amount;
      unallocated += cost.amount;
    }
  }

  const routeIncome = input.earningsMeaning === "route_income";
  // In "route_income" mode the imported DPD figures are income to the franchise, counted as confirmed revenue.
  const otherDpd = routeIncome ? sumPence(otherPayments.map((o) => o.amount)) : 0;
  const dpdIncome = routeIncome ? sumPence([...drivers.values()].map((d) => d.original)) + otherDpd : 0;
  const revenueConfirmed = sumPence(revenue.filter((r) => r.status === "confirmed").map((r) => r.amount)) + dpdIncome;
  const revenueEstimated = sumPence(revenue.filter((r) => r.status === "estimated").map((r) => r.amount));
  const revenueTotal = revenueConfirmed + revenueEstimated;
  const revenueStatus = routeIncome ? combineStatus([statusOfRevenue(revenue), dpdIncome > 0 ? "confirmed" : "unavailable"]) : statusOfRevenue(revenue);

  // Driver-level figures
  const accs = [...drivers.values()];
  // In route_income mode each driver's own DPD income is what they brought in; otherwise revenue is shared by the chosen basis.
  const allocations = routeIncome ? accs.map((a) => a.original) : allocateRevenue(revenueTotal, revenueStatus, accs, input.revenueAllocationBasis);

  const driverSummaries: DriverSummary[] = accs.map((acc, index) => {
    const adj = totalAdjustments(acc.adjustments);
    const finalEarnings = adjustedPay(acc.original, adj);
    const days = acc.dates.size;
    const allocatedRevenue = allocations ? (allocations[index] ?? 0) : null;
    let wage: Pence | null = finalEarnings;
    let wageComplete = true;
    if (routeIncome) {
      if (days === 0) {
        wage = adj.net;
      } else if (acc.driverId && input.dayRates) {
        const w = wageForDriver(acc.driverId, [...acc.dates], input.dayRates, acc.stopsByDate, input.workedBefore?.get(acc.driverId) ?? []);
        wage = w.wage + adj.net;
        wageComplete = w.complete;
      } else {
        wage = null;
        wageComplete = false;
      }
    }
    return {
      key: acc.key,
      driverId: acc.driverId,
      name: acc.name,
      registered: acc.driverId != null,
      franchiseId: acc.franchiseId,
      daysWorked: days,
      parcels: acc.parcels,
      stops: acc.stops,
      parcelsIncomplete: acc.parcelsIncomplete,
      stopsIncomplete: acc.stopsIncomplete,
      originalEarnings: acc.original,
      additionalPayments: adj.additionalPayments,
      deductions: adj.deductions,
      adjustmentsNet: adj.net,
      finalEarnings,
      fuel: acc.fuel,
      otherExpenses: acc.other,
      allocatedRevenue,
      contribution:
        allocatedRevenue == null ? null : routeIncome ? (wage == null || !wageComplete ? null : allocatedRevenue - wage - acc.fuel - acc.other) : allocatedRevenue - finalEarnings - acc.fuel - acc.other,
      contributionStatus: allocatedRevenue == null ? "unavailable" : routeIncome ? (wageComplete ? "confirmed" : "unavailable") : "estimated",
      earningsPerParcel: acc.parcelsIncomplete ? null : perUnit(acc.original, acc.parcels),
      earningsPerStop: acc.stopsIncomplete ? null : perUnit(acc.original, acc.stops),
      parcelsPerStopX100:
        acc.parcelsIncomplete || acc.stopsIncomplete || acc.stops === 0 ? null : Math.round((acc.parcels * 100) / acc.stops),
      avgEarningsPerDay: perUnit(acc.original, days),
      avgStopsPerDayX10: days === 0 || acc.stopsIncomplete ? null : Math.round((acc.stops * 10) / days),
      avgParcelsPerDayX10: days === 0 || acc.parcelsIncomplete ? null : Math.round((acc.parcels * 10) / days),
      wage,
      wageComplete,
    };
  });
  driverSummaries.sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

  const driverOriginal = sumPence(driverSummaries.map((d) => d.originalEarnings));
  const driverAdditional = sumPence(driverSummaries.map((d) => d.additionalPayments));
  const driverDeductions = sumPence(driverSummaries.map((d) => d.deductions));
  const driverAdjNet = sumPence(driverSummaries.map((d) => d.adjustmentsNet));
  const driversMissingRate = routeIncome ? driverSummaries.filter((d) => d.daysWorked > 0 && !d.wageComplete).length : 0;
  const wagesComplete = driversMissingRate === 0;
  const driverCosts = routeIncome ? sumPence(driverSummaries.map((d) => d.wage ?? 0)) : driverOriginal + driverAdjNet;
  const operatingCosts = driverCosts + fuelTotal + otherTotal;
  // Profit is only stated when every figure behind it is known: never guessed from partial wages.
  const operatingProfit = revenueStatus === "unavailable" || (routeIncome && !wagesComplete) ? null : revenueTotal - operatingCosts;
  const profitBeforeWages = routeIncome && revenueStatus !== "unavailable" ? revenueTotal - fuelTotal - otherTotal : null;

  return {
    franchiseId,
    revenueConfirmed,
    revenueEstimated,
    revenueTotal,
    revenueStatus,
    driverOriginalEarnings: driverOriginal,
    driverAdditionalPayments: driverAdditional,
    driverDeductions,
    driverAdjustmentsNet: driverAdjNet,
    driverCosts,
    fuel: fuelTotal,
    otherExpenses: otherTotal,
    unallocatedCosts: unallocated,
    operatingCosts,
    operatingProfit,
    profitStatus: operatingProfit == null ? "unavailable" : revenueStatus,
    marginPercent: operatingProfit == null || revenueTotal === 0 ? null : percentOf(operatingProfit, revenueTotal),
    earningsMeaning: routeIncome ? "route_income" : "driver_pay",
    incomeFromDpd: dpdIncome,
    otherDpdPayments: otherDpd,
    wages: driverCosts,
    wagesComplete,
    driversMissingRate,
    profitBeforeWages,
    parcels: driverSummaries.reduce((n, d) => n + d.parcels, 0),
    stops: driverSummaries.reduce((n, d) => n + d.stops, 0),
    driverCount: driverSummaries.filter((d) => d.daysWorked > 0).length,
    drivers: driverSummaries,
    categories: [...categories.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

/**
 * Shares franchise revenue between drivers by the configured basis. The
 * result is always labelled as an allocation (never "confirmed") and sums to
 * exactly the revenue being shared.
 */
function allocateRevenue(
  revenueTotal: Pence,
  status: FigureStatus,
  drivers: DriverAccumulator[],
  basis: RevenueAllocationBasis,
): Pence[] | null {
  if (status === "unavailable" || basis === "none" || drivers.length === 0) return null;
  const weights = drivers.map((d) => {
    if (basis === "stops") return d.stops;
    if (basis === "parcels") return d.parcels;
    return Math.max(d.original, 0);
  });
  if (weights.reduce((a, b) => a + b, 0) <= 0) return null;
  return allocateProportionally(revenueTotal, weights);
}

function combineStatus(statuses: FigureStatus[]): FigureStatus {
  const present = statuses.filter((s) => s !== "unavailable");
  if (present.length === 0) return "unavailable";
  return present.includes("estimated") ? "estimated" : "confirmed";
}

/**
 * Combines franchise summaries into an all-franchise view. Combined profit is
 * only reported when every franchise with activity has revenue entered;
 * otherwise it would silently understate revenue.
 */
/**
 * Who a driver row belongs to: the registered driver, or, for an unregistered report row, the name as read from the report.
 * The same person can appear under several franchises, or under more than one report reference, so rows are joined on this.
 */
export function driverIdentity(driverId: string | null, name: string): string {
  return driverId ?? `name:${name.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/**
 * One row per person for the combined view. A driver who works for two franchises, or who appears under two report
 * references, becomes one row with the figures added together. A row whose wage is incomplete keeps its wage marked as
 * incomplete, so the merged wage is never stated as final.
 */
export function mergeDriverRows(rows: DriverSummary[]): DriverSummary[] {
  const groups = new Map<string, DriverSummary[]>();
  for (const r of rows) {
    const id = driverIdentity(r.driverId, r.name);
    groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  return [...groups.entries()].map(([id, g]) => {
    if (g.length === 1) return g[0]!;
    const sum = (f: (d: DriverSummary) => number) => g.reduce((t, d) => t + f(d), 0);
    const days = sum((d) => d.daysWorked);
    const stops = sum((d) => d.stops);
    const original = sum((d) => d.originalEarnings);
    const stopsIncomplete = g.some((d) => d.stopsIncomplete);
    const parcelsIncomplete = g.some((d) => d.parcelsIncomplete);
    const knownWages = g.filter((d) => d.wage != null);
    const wage = knownWages.length === 0 ? null : knownWages.reduce((t, d) => t + (d.wage ?? 0), 0);
    return {
      key: id,
      driverId: g.find((d) => d.driverId)?.driverId ?? null,
      name: g[0]!.name,
      registered: g.some((d) => d.registered),
      franchiseId: "",
      daysWorked: days,
      parcels: sum((d) => d.parcels),
      stops,
      parcelsIncomplete,
      stopsIncomplete,
      originalEarnings: original,
      additionalPayments: sum((d) => d.additionalPayments),
      deductions: sum((d) => d.deductions),
      adjustmentsNet: sum((d) => d.adjustmentsNet),
      finalEarnings: sum((d) => d.finalEarnings),
      fuel: sum((d) => d.fuel),
      otherExpenses: sum((d) => d.otherExpenses),
      allocatedRevenue: null,
      contribution: null,
      contributionStatus: "unavailable",
      earningsPerParcel: parcelsIncomplete ? null : perUnit(original, sum((d) => d.parcels)),
      earningsPerStop: stopsIncomplete ? null : perUnit(original, stops),
      parcelsPerStopX100: parcelsIncomplete || stopsIncomplete || stops === 0 ? null : Math.round((sum((d) => d.parcels) * 100) / stops),
      avgEarningsPerDay: perUnit(original, days),
      avgStopsPerDayX10: days === 0 || stopsIncomplete ? null : Math.round((stops * 10) / days),
      avgParcelsPerDayX10: days === 0 || parcelsIncomplete ? null : Math.round((sum((d) => d.parcels) * 10) / days),
      wage,
      wageComplete: g.every((d) => d.wageComplete),
    };
  });
}

export function combineFranchises(franchises: FranchiseSummary[]): FranchiseSummary {
  const sum = (pick: (f: FranchiseSummary) => Pence) => sumPence(franchises.map(pick));
  const revenueTotal = sum((f) => f.revenueTotal);
  const operatingCosts = sum((f) => f.operatingCosts);
  const revenueStatus = combineStatus(franchises.map((f) => f.revenueStatus));
  const missingRevenue = franchises.some(
    (f) => f.franchiseId != null && f.revenueStatus === "unavailable" && f.operatingCosts !== 0,
  );
  const routeIncome = franchises.length > 0 && franchises.every((f) => f.earningsMeaning === "route_income");
  const wagesComplete = franchises.every((f) => f.wagesComplete);
  const operatingProfit = revenueStatus === "unavailable" || missingRevenue || (routeIncome && !wagesComplete) ? null : revenueTotal - operatingCosts;

  const categories = new Map<string, CategoryTotal>();
  for (const f of franchises) {
    for (const c of f.categories) {
      const key = c.kind === "fuel" ? "__fuel__" : (c.categoryId ?? `name:${c.name}`);
      const existing = categories.get(key);
      if (existing) {
        existing.total += c.total;
        existing.allocatedToDrivers += c.allocatedToDrivers;
        existing.franchiseGeneral += c.franchiseGeneral;
        existing.unallocated += c.unallocated;
      } else {
        categories.set(key, { ...c });
      }
    }
  }

  return {
    franchiseId: null,
    revenueConfirmed: sum((f) => f.revenueConfirmed),
    revenueEstimated: sum((f) => f.revenueEstimated),
    revenueTotal,
    revenueStatus,
    driverOriginalEarnings: sum((f) => f.driverOriginalEarnings),
    driverAdditionalPayments: sum((f) => f.driverAdditionalPayments),
    driverDeductions: sum((f) => f.driverDeductions),
    driverAdjustmentsNet: sum((f) => f.driverAdjustmentsNet),
    driverCosts: sum((f) => f.driverCosts),
    fuel: sum((f) => f.fuel),
    otherExpenses: sum((f) => f.otherExpenses),
    unallocatedCosts: sum((f) => f.unallocatedCosts),
    operatingCosts,
    operatingProfit,
    profitStatus: operatingProfit == null ? "unavailable" : revenueStatus,
    marginPercent: operatingProfit == null || revenueTotal === 0 ? null : percentOf(operatingProfit, revenueTotal),
    earningsMeaning: routeIncome ? "route_income" : "driver_pay",
    incomeFromDpd: sum((f) => f.incomeFromDpd),
    otherDpdPayments: sum((f) => f.otherDpdPayments),
    wages: sum((f) => f.wages),
    wagesComplete,
    driversMissingRate: franchises.reduce((n, f) => n + f.driversMissingRate, 0),
    profitBeforeWages: routeIncome && revenueStatus !== "unavailable" && !missingRevenue ? revenueTotal - sum((f) => f.fuel) - sum((f) => f.otherExpenses) : null,
    parcels: franchises.reduce((n, f) => n + f.parcels, 0),
    stops: franchises.reduce((n, f) => n + f.stops, 0),
    driverCount: franchises.reduce((n, f) => n + f.driverCount, 0),
    drivers: franchises.flatMap((f) => f.drivers),
    categories: [...categories.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

// ── Daily ledger (per driver, per day) ──────────────────────────────────────

export interface DriverDay {
  key: string;
  driverId: string | null;
  name: string;
  registered: boolean;
  franchiseId: string;
  date: ISODate;
  parcels: number | null;
  stops: number | null;
  gross: Pence;
  dpdDeductions: Pence;
  dpdAdditional: Pence;
  originalEarnings: Pence;
  adjustmentsNet: Pence;
  finalEarnings: Pence;
  hasReport: boolean;
  adjustmentCount: number;
}

/**
 * One line per driver per day: original DPD figures, manual adjustments and
 * the final adjusted pay. A day with adjustments but no DPD report still
 * appears (original = 0, hasReport = false) so nothing is hidden.
 */
export function buildDriverDays(
  earnings: EarningRow[],
  adjustments: AdjustmentRow[],
  driverNames: Map<string, string>,
): DriverDay[] {
  const days = new Map<string, DriverDay>();
  const keyOf = (franchiseId: string, driverKey: string, date: ISODate) => `${franchiseId}|${driverKey}|${date}`;

  for (const e of earnings) {
    const dk = driverKeyFor(e.driverId, e.driverKey);
    const k = keyOf(e.franchiseId, dk, e.date);
    const original = originalEarnings(e);
    const existing = days.get(k);
    if (existing) {
      existing.parcels = existing.parcels == null || e.parcels == null ? null : existing.parcels + e.parcels;
      existing.stops = existing.stops == null || e.stops == null ? null : existing.stops + e.stops;
      existing.gross += e.gross;
      existing.dpdDeductions += e.deductions;
      existing.dpdAdditional += e.additional;
      existing.originalEarnings += original;
      existing.finalEarnings += original;
    } else {
      days.set(k, {
        key: dk,
        driverId: e.driverId,
        name: e.driverId ? (driverNames.get(e.driverId) ?? e.sourceDriverName) : e.sourceDriverName,
        registered: e.driverId != null,
        franchiseId: e.franchiseId,
        date: e.date,
        parcels: e.parcels,
        stops: e.stops,
        gross: e.gross,
        dpdDeductions: e.deductions,
        dpdAdditional: e.additional,
        originalEarnings: original,
        adjustmentsNet: 0,
        finalEarnings: original,
        hasReport: true,
        adjustmentCount: 0,
      });
    }
  }
  for (const a of adjustments) {
    const k = keyOf(a.franchiseId, a.driverId, a.date);
    let day = days.get(k);
    if (!day) {
      day = {
        key: a.driverId,
        driverId: a.driverId,
        name: driverNames.get(a.driverId) ?? "Unknown driver",
        registered: true,
        franchiseId: a.franchiseId,
        date: a.date,
        parcels: null,
        stops: null,
        gross: 0,
        dpdDeductions: 0,
        dpdAdditional: 0,
        originalEarnings: 0,
        adjustmentsNet: 0,
        finalEarnings: 0,
        hasReport: false,
        adjustmentCount: 0,
      };
      days.set(k, day);
    }
    day.adjustmentsNet += a.amount;
    day.finalEarnings += a.amount;
    day.adjustmentCount += 1;
  }
  return [...days.values()].sort(
    (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "en-GB"),
  );
}

// ── Performance comparison ──────────────────────────────────────────────────

export interface PerformanceComparison {
  /** Percentage change with one decimal place; null when there is no baseline. */
  earningsPerDayChange: number | null;
  stopsPerDayChange: number | null;
  parcelsPerDayChange: number | null;
  baselineDays: number;
}

/** Compares a driver's daily averages for a period against their own earlier history. */
export function comparePerformance(
  current: Pick<DriverSummary, "avgEarningsPerDay" | "avgStopsPerDayX10" | "avgParcelsPerDayX10">,
  baseline: Pick<DriverSummary, "avgEarningsPerDay" | "avgStopsPerDayX10" | "avgParcelsPerDayX10" | "daysWorked"> | null,
): PerformanceComparison {
  const change = (now: number | null, then: number | null | undefined): number | null => {
    if (now == null || then == null || then === 0) return null;
    return Math.round(((now - then) * 1000) / Math.abs(then)) / 10;
  };
  return {
    earningsPerDayChange: change(current.avgEarningsPerDay, baseline?.avgEarningsPerDay),
    stopsPerDayChange: change(current.avgStopsPerDayX10, baseline?.avgStopsPerDayX10),
    parcelsPerDayChange: change(current.avgParcelsPerDayX10, baseline?.avgParcelsPerDayX10),
    baselineDays: baseline?.daysWorked ?? 0,
  };
}
