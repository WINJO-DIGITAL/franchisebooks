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
  key: "login" | "first-read" | "rates";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/**
 * Franchises and drivers are not set-up steps: they come from DPD once a login is connected, so nobody has to type them in
 * (they can still be added by hand in Settings and on the Drivers page).
 */
export function remainingSetupSteps(s: SetupState): SetupStep[] {
  const steps: SetupStep[] = [];
  if (!s.hasDpdLogin) {
    steps.push({ key: "login", title: "Connect Your DPD Login", detail: "Saved encrypted. We read your franchises, drivers, payments and charges from DPD, read-only.", href: "/settings", cta: "Add your login" });
  } else if (!s.hasEarnings) {
    steps.push({ key: "first-read", title: "Reading Your DPD Account", detail: "We are finding your franchises and drivers on DPD. Press Sync DPD to start it now. Your figures appear here once it finishes.", href: "/data", cta: "Open Data & Integrations" });
  }
  if (s.driverCount > 0 && s.ratesMatter && s.driversWithoutRate > 0) {
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

export interface ChecklistItem {
  key: "login" | "first-read" | "rates";
  title: string;
  detail: string;
  href: string;
  cta: string;
  done: boolean;
}

/**
 * The first-franchisee checklist on the dashboard: the three things that get an account working, ticked off as they are
 * done. Shown until all three are done. Once the first sync has brought drivers in, the pay-rate step names how many
 * drivers still need one (their statements and wages wait for it). Pure code.
 */
export function setupChecklist(s: SetupState): ChecklistItem[] {
  const ratesDone = !(s.driverCount > 0 && s.ratesMatter && s.driversWithoutRate > 0);
  const items: ChecklistItem[] = [
    { key: "login", title: "Connect Your DPD Login", detail: "Saved encrypted and read-only.", href: "/settings", cta: "Add your login", done: s.hasDpdLogin },
    { key: "first-read", title: "First read of your DPD account", detail: s.hasEarnings ? "Your franchises, drivers and payments have been read from DPD." : "Press Sync DPD to start it now. Your figures appear once it finishes.", href: "/data", cta: "Open Data & Integrations", done: s.hasEarnings },
    {
      key: "rates",
      title: ratesDone ? "Set your drivers' pay rates" : `Set the pay rate for ${s.driversWithoutRate} driver${s.driversWithoutRate === 1 ? "" : "s"}`,
      detail: ratesDone
        ? "Every driver who has worked has a pay rate."
        : "Per day worked or per stop. Until a driver has one, their wages show as incomplete and no driver statement is made for them.",
      href: "/drivers",
      cta: "Set pay rates",
      done: s.hasEarnings && ratesDone,
    },
  ];
  return items.every((i) => i.done) ? [] : items;
}
