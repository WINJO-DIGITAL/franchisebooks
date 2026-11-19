/**
 * Loads the rows the finance engine needs for a date range and converts them
 * to its input types. Works with either a user-session client (RLS applies)
 * or the service-role client; the account filter is always applied explicitly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ISODate } from "@/lib/dates";
import type {
  AdjustmentRow, AdjustmentType, CostAllocation, CostRow, CoverRow, EarningRow, EarningsMeaning, OtherPaymentRow, PeriodInput, RevenueAllocationBasis, RevenueRow,
} from "@/lib/finance/calc";
import type { DayRate } from "@/lib/finance/wages";
import { DAILY_PAYMENT_LINE } from "@/lib/ingest/invoice";
import { fromDb, fromDbNullable, type Pence } from "@/lib/money";
import type { Database } from "@/lib/supabase/database.types";
import { fetchAll, must } from "./fetch-all";

type Db = SupabaseClient<Database>;

export interface PeriodFilter {
  accountId: string;
  from: ISODate;
  to: ISODate;
  /** Restrict to one franchise; omit for all franchises. */
  franchiseId?: string | null;
}

export interface CostDetail extends CostRow {
  description: string | null;
  supplier: string | null;
  vehicleRegistration: string | null;
  reference: string | null;
  sourceDriverName: string | null;
  source: string;
  importedFileId: string | null;
  allocationMethod: string | null;
  allocationNote: string | null;
  litres: number | null;
  pricePerLitre: number | null;
  /** The VAT the portal states for this charge, added on top of amount. Null when none is stated. */
  vat: number | null;
}

export interface EarningDetail extends EarningRow {
  route: string | null;
  payPerParcel: string | null;
  payPerStop: string | null;
  importedFileId: string;
  source: string;
  /** Details from the DPD Payments table; null for days imported before they were read. */
  excessParcels?: number | null;
  mileage?: number | null;
  stopPay?: Pence | null;
  parcelPay?: Pence | null;
  /** The DPD driver reference (for example DR66445), when the report gave one. */
  driverRef?: string | null;
}

export interface AdjustmentDetail extends AdjustmentRow {
  reason: string;
  createdBy: string;
  createdAt: string;
}

export interface PeriodData extends PeriodInput {
  earnings: EarningDetail[];
  adjustments: AdjustmentDetail[];
  costs: CostDetail[];
  /** The invoice's extra lines that the daily Payments do not contain (Fuel Supplement, C&D App). Counted as income once. */
  otherPayments: OtherPaymentDetail[];
}

export async function loadDriverNames(db: Db, accountId: string): Promise<Map<string, string>> {
  const rows = await fetchAll(() => db.from("drivers").select("id, display_name").eq("account_id", accountId).order("id"));
  return new Map(rows.map((r) => [r.id, r.display_name]));
}

export async function loadEarnings(db: Db, filter: PeriodFilter & { driverId?: string }): Promise<EarningDetail[]> {
  const rows = await fetchAll(() => {
    let q = db
      .from("daily_earnings")
      .select("id, franchise_id, driver_id, driver_key, source_driver_name, report_date, route, parcels, stops, pay_per_parcel, pay_per_stop, gross_earnings, deductions, additional_payments, net_earnings, imported_file_id, source, excess_parcels, mileage, stop_pay, parcel_pay, source_driver_ref")
      .eq("account_id", filter.accountId)
      .eq("is_current", true)
      .gte("report_date", filter.from)
      .lte("report_date", filter.to)
      .order("report_date")
      .order("id");
    if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
    if (filter.driverId) q = q.eq("driver_id", filter.driverId);
    return q;
  });
  return rows.map((r) => ({
    id: r.id,
    franchiseId: r.franchise_id,
    driverId: r.driver_id,
    driverKey: r.driver_key,
    sourceDriverName: r.source_driver_name,
    date: r.report_date,
    route: r.route,
    parcels: r.parcels,
    stops: r.stops,
    payPerParcel: r.pay_per_parcel == null ? null : Number(r.pay_per_parcel).toFixed(4),
    payPerStop: r.pay_per_stop == null ? null : Number(r.pay_per_stop).toFixed(4),
    gross: fromDb(r.gross_earnings),
    deductions: fromDb(r.deductions),
    additional: fromDb(r.additional_payments),
    netSupplied: fromDbNullable(r.net_earnings),
    importedFileId: r.imported_file_id,
    source: r.source,
    excessParcels: r.excess_parcels,
    mileage: r.mileage,
    stopPay: fromDbNullable(r.stop_pay),
    parcelPay: fromDbNullable(r.parcel_pay),
    driverRef: r.source_driver_ref,
  }));
}

export async function loadAdjustments(db: Db, filter: PeriodFilter & { driverId?: string }): Promise<AdjustmentDetail[]> {
  const rows = await fetchAll(() => {
    let q = db
      .from("earnings_adjustments")
      .select("id, franchise_id, driver_id, earnings_date, adjustment_type, amount, reason, cover_record_id, reverses_adjustment_id, created_by, created_at")
      .eq("account_id", filter.accountId)
      .gte("earnings_date", filter.from)
      .lte("earnings_date", filter.to)
      .order("earnings_date")
      .order("id");
    if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
    if (filter.driverId) q = q.eq("driver_id", filter.driverId);
    return q;
  });
  return rows.map((r) => ({
    id: r.id,
    franchiseId: r.franchise_id,
    driverId: r.driver_id,
    date: r.earnings_date,
    type: r.adjustment_type as AdjustmentType,
    amount: fromDb(r.amount),
    reason: r.reason,
    coverRecordId: r.cover_record_id,
    reversesId: r.reverses_adjustment_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}

interface AllocationInfo {
  allocation: CostAllocation;
  method: string | null;
  note: string | null;
}

async function loadAllocations(db: Db, accountId: string): Promise<{ fuel: Map<string, AllocationInfo>; expense: Map<string, AllocationInfo> }> {
  const rows = await fetchAll(() =>
    db
      .from("expense_allocations")
      .select("id, expense_id, fuel_transaction_id, scope, driver_id, method, note")
      .eq("account_id", accountId)
      .eq("is_current", true)
      .order("id"),
  );
  const fuel = new Map<string, AllocationInfo>();
  const expense = new Map<string, AllocationInfo>();
  for (const r of rows) {
    const info: AllocationInfo = {
      allocation: r.scope === "driver" && r.driver_id ? { scope: "driver", driverId: r.driver_id } : { scope: "franchise" },
      method: r.method,
      note: r.note,
    };
    if (r.fuel_transaction_id) fuel.set(r.fuel_transaction_id, info);
    if (r.expense_id) expense.set(r.expense_id, info);
  }
  return { fuel, expense };
}

export async function loadCosts(db: Db, filter: PeriodFilter): Promise<CostDetail[]> {
  const [fuelRows, expenseRows, categories, allocations] = await Promise.all([
    fetchAll(() => {
      let q = db
        .from("fuel_transactions")
        .select("id, franchise_id, transaction_date, description, supplier, vehicle_registration, source_driver_name, litres, price_per_litre, total_cost, transaction_ref, source, imported_file_id")
        .eq("account_id", filter.accountId)
        .eq("is_void", false)
        .gte("transaction_date", filter.from)
        .lte("transaction_date", filter.to)
        .order("transaction_date")
        .order("id");
      if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
      return q;
    }),
    fetchAll(() => {
      let q = db
        .from("expenses")
        .select("id, franchise_id, category_id, expense_date, description, supplier, vehicle_registration, source_driver_name, amount, vat_amount, transaction_ref, source, imported_file_id")
        .eq("account_id", filter.accountId)
        .eq("is_void", false)
        .gte("expense_date", filter.from)
        .lte("expense_date", filter.to)
        .order("expense_date")
        .order("id");
      if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
      return q;
    }),
    db.from("expense_categories").select("id, name, kind").eq("account_id", filter.accountId).then((r) => must(r, "Loading expense categories")),
    loadAllocations(db, filter.accountId),
  ]);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const unallocated: AllocationInfo = { allocation: { scope: "unallocated" }, method: null, note: null };
  // A charge DPD itself raises against a franchise (management fee, lease, van hire) belongs to that franchise as a whole,
  // so it needs no assigning to a driver. A person can still assign it to a driver later.
  const dpdFranchiseCharge: AllocationInfo = { allocation: { scope: "franchise" }, method: "dpd_franchise_charge", note: "Charged by DPD to the franchise" };

  const costs: CostDetail[] = [];
  for (const r of fuelRows) {
    const info = allocations.fuel.get(r.id) ?? unallocated;
    costs.push({
      id: r.id, kind: "fuel", franchiseId: r.franchise_id, date: r.transaction_date, amount: fromDb(r.total_cost),
      categoryId: null, categoryName: "Fuel", categoryKind: "fuel", allocation: info.allocation,
      description: r.description, supplier: r.supplier, vehicleRegistration: r.vehicle_registration, reference: r.transaction_ref,
      sourceDriverName: r.source_driver_name, source: r.source, importedFileId: r.imported_file_id,
      allocationMethod: info.method, allocationNote: info.note,
      litres: r.litres == null ? null : Number(r.litres), pricePerLitre: r.price_per_litre == null ? null : Number(r.price_per_litre), vat: null,
    });
  }
  for (const r of expenseRows) {
    const info = allocations.expense.get(r.id) ?? (r.source === "dpd_portal" && r.franchise_id ? dpdFranchiseCharge : unallocated);
    const category = categoryById.get(r.category_id);
    costs.push({
      id: r.id, kind: "expense", franchiseId: r.franchise_id, date: r.expense_date, amount: fromDb(r.amount),
      categoryId: r.category_id, categoryName: category?.name ?? "Uncategorised",
      categoryKind: (category?.kind as CostRow["categoryKind"]) ?? "other", allocation: info.allocation,
      description: r.description, supplier: r.supplier, vehicleRegistration: r.vehicle_registration, reference: r.transaction_ref,
      sourceDriverName: r.source_driver_name, source: r.source, importedFileId: r.imported_file_id,
      allocationMethod: info.method, allocationNote: info.note, litres: null, pricePerLitre: null, vat: r.vat_amount == null ? null : fromDb(r.vat_amount),
    });
  }
  return costs;
}

export async function loadCovers(db: Db, filter: PeriodFilter): Promise<(CoverRow & { route: string | null; notes: string | null; amountToCovering: number; amountFromOriginal: number; earningsAllocation: string; createdAt: string; cancelReason: string | null })[]> {
  const rows = await fetchAll(() => {
    let q = db
      .from("driver_cover_records")
      .select("id, franchise_id, cover_date, original_driver_id, covering_driver_id, expense_attribution, status, route, notes, amount_to_covering, amount_from_original, earnings_allocation, created_at, cancel_reason")
      .eq("account_id", filter.accountId)
      .gte("cover_date", filter.from)
      .lte("cover_date", filter.to)
      .order("cover_date", { ascending: false })
      .order("id");
    if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
    return q;
  });
  return rows.map((r) => ({
    id: r.id,
    franchiseId: r.franchise_id,
    date: r.cover_date,
    originalDriverId: r.original_driver_id,
    coveringDriverId: r.covering_driver_id,
    expenseAttribution: r.expense_attribution as CoverRow["expenseAttribution"],
    status: r.status as CoverRow["status"],
    route: r.route,
    notes: r.notes,
    amountToCovering: fromDb(r.amount_to_covering),
    amountFromOriginal: fromDb(r.amount_from_original),
    earningsAllocation: r.earnings_allocation,
    createdAt: r.created_at,
    cancelReason: r.cancel_reason,
  }));
}

export async function loadRevenue(db: Db, filter: PeriodFilter): Promise<(RevenueRow & { description: string | null; source: string; createdAt: string })[]> {
  const rows = await fetchAll(() => {
    let q = db
      .from("revenue_entries")
      .select("id, franchise_id, period_start, period_end, amount, status, description, source, created_at")
      .eq("account_id", filter.accountId)
      .eq("is_void", false)
      .gte("period_start", filter.from)
      .lte("period_start", filter.to)
      .order("period_start")
      .order("id");
    if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
    return q;
  });
  return rows.map((r) => ({
    id: r.id,
    franchiseId: r.franchise_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    amount: fromDb(r.amount),
    status: r.status as RevenueRow["status"],
    description: r.description,
    source: r.source,
    createdAt: r.created_at,
  }));
}

export async function loadRevenueBasis(db: Db, accountId: string): Promise<RevenueAllocationBasis> {
  const { data } = await db.from("app_settings").select("revenue_allocation_basis").eq("account_id", accountId).maybeSingle();
  return (data?.revenue_allocation_basis as RevenueAllocationBasis | undefined) ?? "none";
}

export async function loadEarningsMeaning(db: Db, accountId: string): Promise<EarningsMeaning> {
  const { data } = await db.from("app_settings").select("earnings_meaning").eq("account_id", accountId).maybeSingle();
  return data?.earnings_meaning === "route_income" ? "route_income" : "driver_pay";
}

/** Every day rate the account has set, newest last. Wages pick the rate in force on each day worked. */
export async function loadDayRates(db: Db, accountId: string): Promise<DayRate[]> {
  const rows = await fetchAll(() => db.from("driver_day_rates").select("driver_id, day_rate, effective_from, pay_basis").eq("account_id", accountId).order("effective_from").order("id"));
  return rows.map((r) => ({ driverId: r.driver_id, dayRate: fromDb(r.day_rate), effectiveFrom: r.effective_from, basis: r.pay_basis === "stop" ? "stop" : "day" }));
}

export interface OtherPaymentDetail extends OtherPaymentRow {
  invoiceDate: ISODate;
  periodEnd: ISODate;
}

/**
 * Extra DPD payments: invoice lines that are not already in the daily Payments (Fuel Supplement, C&D App and anything
 * else new), dated at the invoice period's start. Stop pay, excess parcels and the other daily lines are skipped, so
 * nothing is counted twice. Only reconciled invoices (lines add up to the printed net) are used.
 */
export async function loadOtherPayments(db: Db, filter: PeriodFilter): Promise<OtherPaymentDetail[]> {
  const rows = await fetchAll(() => {
    let q = db
      .from("dpd_invoices")
      .select("id, franchise_id, invoice_no, invoice_date, period_start, period_end, lines, reconciled")
      .eq("account_id", filter.accountId)
      .eq("reconciled", true)
      .gte("period_start", filter.from)
      .lte("period_start", filter.to)
      .order("period_start")
      .order("id");
    if (filter.franchiseId) q = q.eq("franchise_id", filter.franchiseId);
    return q;
  });
  return otherPaymentsFromInvoices(rows);
}

/** Pure part of loadOtherPayments, so it can be tested without a database. */
export function otherPaymentsFromInvoices(rows: {
  id: string; franchise_id: string; invoice_no: string; invoice_date: string; period_start: string; period_end: string; lines: unknown;
}[]): OtherPaymentDetail[] {
  const out: OtherPaymentDetail[] = [];
  for (const r of rows) {
    const lines = Array.isArray(r.lines) ? (r.lines as { description?: string; amount?: number }[]) : [];
    lines.forEach((l, i) => {
      if (!l.description || typeof l.amount !== "number" || DAILY_PAYMENT_LINE.test(l.description)) return;
      out.push({
        id: `${r.id}:${i}`, franchiseId: r.franchise_id, date: r.period_start as ISODate, label: l.description.trim(), amount: l.amount as Pence,
        invoiceNo: r.invoice_no, invoiceDate: r.invoice_date as ISODate, periodEnd: r.period_end as ISODate,
      });
    });
  }
  return out;
}

/** Everything the finance engine needs for a period, in one call. */
export async function loadPeriodData(db: Db, filter: PeriodFilter): Promise<PeriodData> {
  const [earnings, adjustments, costs, covers, revenue, driverNames, basis, earningsMeaning, dayRates, otherPayments] = await Promise.all([
    loadEarnings(db, filter),
    loadAdjustments(db, filter),
    loadCosts(db, filter),
    loadCovers(db, filter),
    loadRevenue(db, filter),
    loadDriverNames(db, filter.accountId),
    loadRevenueBasis(db, filter.accountId),
    loadEarningsMeaning(db, filter.accountId),
    loadDayRates(db, filter.accountId),
    loadOtherPayments(db, filter),
  ]);
  return { from: filter.from, to: filter.to, earnings, adjustments, costs, covers, revenue, driverNames, revenueAllocationBasis: basis, earningsMeaning, dayRates, otherPayments };
}
