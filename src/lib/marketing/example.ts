/**
 * The example figures shown on the sales page.
 *
 * They are illustrations, labelled "Example" wherever they appear, and are never real customer data. They are held in one
 * place so every preview tells the same story and the figures add up exactly (a test checks it). Amounts are whole pence.
 */

import type { Pence } from "@/lib/money";

const pounds = (n: number): Pence => Math.round(n * 100);

/** Income from DPD for each of the 28 days of the example period, Monday first. Sundays carry no deliveries. */
export const EXAMPLE_DAILY_INCOME: readonly Pence[] = [
  [285, 290, 290, 295, 300, 160, 0],
  [280, 295, 285, 300, 290, 170, 0],
  [290, 285, 295, 290, 300, 160, 0],
  [295, 290, 285, 300, 285, 165, 0],
].flat().map(pounds);

export const EXAMPLE_PERIOD = {
  income: pounds(6480),
  charges: pounds(740),
  driverPay: pounds(3160),
  profit: pounds(2580),
} as const;

export interface ExampleDriver {
  name: string;
  /** How this driver is paid, in the words the app uses. */
  basis: "Per day" | "Per stop";
  /** The rate, in pence, for one day or one stop. */
  rate: Pence;
  /** Days worked (per-day pay) or stops delivered (per-stop pay). */
  quantity: number;
  owed: Pence;
}

export const EXAMPLE_DRIVERS: readonly ExampleDriver[] = [
  { name: "Alex", basis: "Per day", rate: pounds(90), quantity: 18, owed: pounds(1620) },
  { name: "Sam", basis: "Per day", rate: pounds(90), quantity: 14, owed: pounds(1260) },
  { name: "Jo", basis: "Per stop", rate: pounds(0.5), quantity: 560, owed: pounds(280) },
];

export interface ExampleFranchise {
  name: string;
  drivers: number;
  stops: number;
  income: Pence;
  profit: Pence;
}

export const EXAMPLE_FRANCHISES: readonly ExampleFranchise[] = [
  { name: "Northside", drivers: 3, stops: 7420, income: pounds(6480), profit: pounds(2580) },
  { name: "Eastgate", drivers: 2, stops: 5610, income: pounds(4950), profit: pounds(1905) },
  { name: "Harbour Road", drivers: 2, stops: 3380, income: pounds(3210), profit: pounds(1320) },
];

/** Two outcomes of the invoice check: the daily payments agree with the invoice, or one day is missing. */
export const EXAMPLE_CHECKS = {
  matches: { dailyPayments: pounds(6480), invoiceStopPay: pounds(6480) },
  differs: { dailyPayments: pounds(6320), invoiceStopPay: pounds(6480) },
} as const;
