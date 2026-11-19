/**
 * Small, pure access rules shared by pages and server actions, kept here so they can be unit tested.
 */

export type Role = "owner" | "manager" | "viewer";

/**
 * Who is looking at the "Choose your plan" page.
 * - "driver": a driver's login. Drivers never pay; they go to their own page.
 * - "member": a manager or viewer in someone else's business. The business owner pays for everyone.
 * - "payer": anyone else (a new sign-up or the owner), who may start a subscription.
 */
export function billingAudience(input: { isDriver: boolean; role: Role | null }): "driver" | "member" | "payer" {
  if (input.isDriver) return "driver";
  if (input.role === "manager" || input.role === "viewer") return "member";
  return "payer";
}

/** Whether this login can see every franchise in the business (owners always can). */
export function seesAllFranchises(input: { role: Role; allFranchises: boolean }): boolean {
  return input.role === "owner" || input.allFranchises;
}

/**
 * Checks the franchise chosen for a report. Returns a message to show, or null when the choice is allowed.
 * An empty franchise means "All franchises (consolidated)", which only logins that can see every franchise may make,
 * because the report is built with elevated rights and would otherwise include franchises they cannot see.
 */
export function reportScopeProblem(input: {
  role: Role;
  allFranchises: boolean;
  visibleFranchiseIds: string[];
  franchiseId: string | null;
}): string | null {
  if (input.franchiseId) {
    return input.visibleFranchiseIds.includes(input.franchiseId) ? null : "Choose one of your franchises.";
  }
  if (!seesAllFranchises(input)) return "Choose one of your franchises. Your login covers only some franchises, so it cannot make an all-franchises report.";
  if (input.role !== "owner" && input.visibleFranchiseIds.length === 0) return "There is nothing to report on yet.";
  return null;
}

/**
 * For an upload by a login that covers only some franchises: the franchises the file's rows would go to that the login
 * does not cover. An empty franchise ("") means a row with no franchise, which only full-access logins may add.
 * `allowed` null means the login covers every franchise, so nothing is outside.
 */
export function franchisesOutsideAccess(rowFranchiseIds: (string | null)[], allowed: string[] | null): (string | null)[] {
  if (!allowed) return [];
  const outside = new Set<string | null>();
  for (const id of rowFranchiseIds) if (!id || !allowed.includes(id)) outside.add(id || null);
  return [...outside];
}

/** The message shown when an upload names franchises outside the login's access. */
export function outsideAccessMessage(filename: string, fdNumbers: string[]): string {
  if (fdNumbers.length === 0) {
    return `“${filename}” could not be matched to one of your franchises, and your login doesn't cover the others. Choose your franchise when uploading, or ask the owner to upload it. Nothing was imported.`;
  }
  const list = fdNumbers.length === 1 ? fdNumbers[0] : `${fdNumbers.slice(0, -1).join(", ")} and ${fdNumbers[fdNumbers.length - 1]}`;
  return `“${filename}” is for ${list}, which your login doesn't cover. Ask the owner to upload it. Nothing was imported.`;
}
