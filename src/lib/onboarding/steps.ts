/**
 * The set-up steps a new account still has to do, in order. Only steps that are still to do are returned; once the account
 * is fully set up the list is empty and nothing is shown. Pure code.
 */

export interface SetupState {
  franchiseCount: number;
  /** A DPD login has been saved for the account. */
  hasDpdLogin: boolean;
  /** At least one DPD payment has been read. */
  hasEarnings: boolean;
  driverCount: number;
  /** Drivers who have days worked but no pay rate set. */
  driversWithoutRate: number;
  /** Wages are worked out from rates (route-income accounts), so a missing rate matters. */
  ratesMatter: boolean;
}

export interface SetupStep {
  key: "franchises" | "login" | "first-read" | "drivers" | "rates";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

export function remainingSetupSteps(s: SetupState): SetupStep[] {
  const steps: SetupStep[] = [];
  if (s.franchiseCount === 0) {
    steps.push({ key: "franchises", title: "Add your franchises", detail: "Enter each FD number exactly as it appears on DPD documents.", href: "/settings", cta: "Add a franchise" });
  }
  if (!s.hasDpdLogin) {
    steps.push({ key: "login", title: "Connect your DPD login", detail: "Saved encrypted. It lets us read your payments and charges every night, read-only.", href: "/settings", cta: "Add your login" });
  } else if (s.franchiseCount > 0 && !s.hasEarnings) {
    steps.push({ key: "first-read", title: "Run your first read", detail: "Press Sync DPD, or wait for tonight's automatic read. Your figures appear here once it finishes.", href: "/data", cta: "Open Data & Integrations" });
  }
  if (s.driverCount === 0) {
    steps.push({ key: "drivers", title: "Add your drivers", detail: "So their days and pay can be worked out. Drivers who appear in DPD reports are added for you when you link them.", href: "/drivers/new", cta: "Add a driver" });
  } else if (s.ratesMatter && s.driversWithoutRate > 0) {
    steps.push({
      key: "rates",
      title: `Set the pay rate for ${s.driversWithoutRate} driver${s.driversWithoutRate === 1 ? "" : "s"}`,
      detail: "Choose per day worked or per stop. Until then their wages show as incomplete.",
      href: "/drivers",
      cta: "Set pay rates",
    });
  }
  return steps;
}
