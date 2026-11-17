/**
 * A signed-in, read-only browser session on the DPD partner portal.
 * Used only by the background worker — never from the web app.
 */

import type { Browser, BrowserContext, Download, Locator, Page } from "playwright";
import type { ISODate } from "@/lib/dates";
import { scrubSecrets } from "@/lib/logger";
import { PortalError } from "./errors";
import { ReadOnlyGuard, safeClick, WRITE_ACTION_PATTERN } from "./guard";
import { findPeriodIndex, parsePeriodText, tableShowsPeriod, yearCandidates } from "./period";
import { fillTemplate, formatDateToken, type PortalMap, type PortalReport, type PortalStep, type PortalTarget, type TemplateValues } from "./portal-map";
import { transformTable } from "./table";

export interface PortalCredentials {
  url: string;
  username: string;
  password: string;
  loginSecret: string | null;
}

export interface CollectedDocument {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sourceRef: string;
}

const CAPTCHA_SELECTOR = 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, [data-sitekey]';
const MFA_TEXT = /verification code|one[- ]time (pass)?code|authenticator app|two[- ]factor|2fa|security code|enter the code/i;
const LOGIN_ERROR_TEXT = /incorrect|invalid|not recognised|not recognized|wrong (user|pass)|failed to (log|sign)|locked/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class PortalSession {
  private lastNavigation = 0;
  signedIn = false;

  private constructor(
    private readonly browser: Browser,
    readonly context: BrowserContext,
    readonly page: Page,
    readonly guard: ReadOnlyGuard,
    private readonly credentials: PortalCredentials,
    readonly map: PortalMap,
  ) {}

  static async open(credentials: PortalCredentials, map: PortalMap): Promise<PortalSession> {
    const { chromium } = await import("playwright");
    const origin = new URL(credentials.url).origin;
    const loginUrl = new URL(map.login.path || "", credentials.url);
    const loginPatterns = map.login.postPatterns.length
      ? map.login.postPatterns.map((p) => new RegExp(p))
      : [new RegExp(`^${escapeRegExp(origin)}${escapeRegExp(loginUrl.pathname)}([?#].*)?$`)];
    const guard = new ReadOnlyGuard(loginPatterns, map.readOnlyPostPatterns.map((p) => new RegExp(p)));

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ acceptDownloads: true, locale: "en-GB", timezoneId: "Europe/London" });
      context.setDefaultTimeout(20_000);
      context.setDefaultNavigationTimeout(45_000);
      await guard.install(context);
      const page = await context.newPage();
      // Code compiled by tsx adds a `__name` helper to functions passed to page.evaluate; define it in the page too.
      await page.addInitScript({ content: "window.__name = window.__name || ((f) => f);" });
      return new PortalSession(browser, context, page, guard, credentials, map);
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }

  /** Waits so that page loads are never closer together than the configured delay. */
  private async pace(): Promise<void> {
    const wait = this.lastNavigation + this.map.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastNavigation = Date.now();
  }

  async goto(pathOrUrl: string, stepName: string): Promise<void> {
    await this.pace();
    const url = new URL(pathOrUrl, this.credentials.url).toString();
    try {
      const response = await this.page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && response.status() >= 500) {
        throw new PortalError("network", stepName, "The DPD portal is not responding properly at the moment.", `HTTP ${response.status()} for ${new URL(url).pathname}`);
      }
      if (response && (response.status() === 401 || response.status() === 403)) {
        throw new PortalError("auth", stepName, "The DPD portal refused access to a page this account was expected to see.", `HTTP ${response.status()} for ${new URL(url).pathname}`);
      }
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError("network", stepName, "The DPD portal could not be reached.", scrubSecrets(String((error as Error).message)));
    }
    await this.settle();
  }

  private async settle(): Promise<void> {
    await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  }

  private locate(target: PortalTarget, values: TemplateValues): { locator: Locator; name: string } {
    const name = fillTemplate(target.name, values);
    return { locator: this.page.getByRole(target.role, { name: target.exact ? name : new RegExp(escapeRegExp(name), "i"), exact: target.exact }), name };
  }

  private field(label: string): Locator {
    const pattern = new RegExp(label, "i");
    return this.page.getByLabel(pattern).or(this.page.getByPlaceholder(pattern)).first();
  }

  /** Signs in with the supplied credentials and confirms that it worked. Never bypasses MFA or CAPTCHAs. */
  async login(): Promise<void> {
    const { login } = this.map;
    await this.goto(login.path || this.credentials.url, "login:open");

    if (await this.page.locator(CAPTCHA_SELECTOR).count()) {
      throw new PortalError("blocked", "login:captcha", "The DPD portal is asking for a CAPTCHA, which cannot (and will not) be completed automatically. Download the reports and upload them by hand, or use Dropbox.");
    }

    const username = this.field(login.usernameLabel);
    const password = this.page.getByLabel(new RegExp(login.passwordLabel, "i")).or(this.page.locator('input[type="password"]')).first();
    if (!(await username.count()) || !(await password.count())) {
      throw new PortalError("layout", "login:fields", "The DPD portal login page was not recognised. The page layout may have changed.", "Username or password field not found");
    }
    await username.fill(this.credentials.username);
    await password.fill(this.credentials.password);
    if (login.secretLabel && this.credentials.loginSecret) {
      const secret = this.field(login.secretLabel);
      if (await secret.count()) await secret.fill(this.credentials.loginSecret);
    }

    const submit = this.page.getByRole("button", { name: new RegExp(login.submitName, "i") }).first();
    if (!(await submit.count())) {
      throw new PortalError("layout", "login:submit", "The DPD portal login page was not recognised. The page layout may have changed.", "Sign-in button not found");
    }
    await this.pace();
    await Promise.all([this.page.waitForLoadState("domcontentloaded").catch(() => undefined), submit.click()]);
    await this.settle();

    const body = (await this.page.locator("body").innerText().catch(() => "")).slice(0, 4000);
    // The portal is an Angular app: its navigation (including "Log out") is drawn a few seconds after the page loads.
    const signedInMarker = this.page.getByRole("link", { name: new RegExp(login.signedInName, "i") })
      .or(this.page.getByRole("button", { name: new RegExp(login.signedInName, "i") }));
    await signedInMarker.first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
    const signedIn = await signedInMarker.count();

    if (!signedIn) {
      if (MFA_TEXT.test(body)) {
        throw new PortalError("blocked", "login:mfa", "The DPD portal asked for a verification code. Automatic sign-in stops here on purpose — it will not try to get around two-step verification. Download the reports and upload them by hand, or use Dropbox.");
      }
      if (await this.page.locator(CAPTCHA_SELECTOR).count()) {
        throw new PortalError("blocked", "login:captcha", "The DPD portal is asking for a CAPTCHA, which cannot (and will not) be completed automatically.");
      }
      if (LOGIN_ERROR_TEXT.test(body)) {
        throw new PortalError("auth", "login:rejected", "The DPD portal did not accept the username and password. Please check the login details set on the worker.");
      }
      throw new PortalError("layout", "login:confirm", "Sign-in to the DPD portal could not be confirmed. The page layout may have changed.", "Signed-in marker not found after submitting the login form");
    }
    this.guard.endLoginPhase();
    this.signedIn = true;
  }

  /**
   * Chooses an option in a labelled drop-down. This only sets a filter on the page (the portal's own
   * data request is a GET, which the read-only guard allows). Returns false when no option matches.
   */
  private async chooseOption(label: string, matches: (optionText: string) => boolean, stepName: string): Promise<boolean> {
    if (WRITE_ACTION_PATTERN.test(label)) {
      throw new PortalError("blocked", stepName, `The drop-down “${label}” looks like a control that changes data, so it was not touched.`);
    }
    const select = this.page.getByLabel(new RegExp(label, "i")).first();
    // The portal draws its filters a few seconds after the page loads.
    await select.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    if (!(await select.count())) {
      throw new PortalError("layout", stepName, `The “${label}” filter was not found on the page. The portal layout may have changed.`);
    }
    // The options are filled in after the filter appears, so wait for the one we want (up to about 15 seconds).
    let index = -1;
    for (let attempt = 0; attempt < 15; attempt++) {
      const options = (await select.locator("option").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
      index = options.findIndex(matches);
      if (index >= 0) break;
      await this.page.waitForTimeout(1000);
    }
    if (index < 0) return false;
    await this.pace();
    await select.selectOption({ index });
    await this.settle();
    await this.page.waitForTimeout(1500); // the table redraws after the data arrives
    return true;
  }

  async runSteps(steps: PortalStep[], values: TemplateValues, stepPrefix: string): Promise<void> {
    for (const [index, step] of steps.entries()) {
      const stepName = `${stepPrefix}:${index + 1}`;
      if (step.action === "goto") {
        await this.goto(fillTemplate(step.path, values), stepName);
      } else if (step.action === "select") {
        const wanted = fillTemplate(step.option, values).toLowerCase();
        const chosen = await this.chooseOption(step.label, (text) => text.toLowerCase().includes(wanted), stepName);
        if (!chosen) {
          throw new PortalError("layout", stepName, `“${fillTemplate(step.option, values)}” is not in the “${step.label}” filter, so nothing was downloaded for it. Check the franchise's FD number.`);
        }
      } else {
        const { locator, name } = this.locate(step.target, values);
        await this.pace();
        await safeClick(locator, name);
        await this.settle();
      }
    }
  }

  async openFranchise(fd: string, date: ISODate): Promise<void> {
    const franchise = this.map.franchise;
    if (franchise.mode === "url") await this.goto(fillTemplate(franchise.template, { fd, date }), "franchise:open");
    else if (franchise.mode === "steps") await this.runSteps(franchise.steps, { fd, date }, "franchise");
    const body = (await this.page.locator("body").innerText().catch(() => "")).toUpperCase();
    if (franchise.mode !== "none" && !body.includes(fd.toUpperCase())) {
      throw new PortalError("layout", "franchise:confirm", `The DPD portal page for franchise ${fd} could not be confirmed, so nothing was downloaded for it.`, "FD number not present on the page after navigation");
    }
  }

  private async selectDate(report: PortalReport, values: TemplateValues): Promise<void> {
    const selection = report.date;
    if (selection.mode === "none") return;
    if (selection.mode === "period_select") {
      const stepName = `${report.id}:period`;
      for (const year of yearCandidates(values.date)) {
        const hasYear = await this.chooseOption(selection.yearLabel, (text) => text === year, stepName);
        if (!hasYear) continue;
        const periodSelect = this.page.getByLabel(new RegExp(selection.periodLabel, "i")).first();
        const texts = (await periodSelect.locator("option").allTextContents()).map((text) => text.replace(/\s+/g, " ").trim());
        const at = findPeriodIndex(texts, values.date);
        if (at < 0) continue;
        values.period = parsePeriodText(texts[at]!);
        await this.chooseOption(selection.periodLabel, (text) => text === texts[at], stepName);
        return;
      }
      throw new PortalError("layout", stepName, `No reporting period containing ${values.date} was found on the “${report.label}” page. The period may not exist yet.`);
    }
    if (selection.mode === "url_param") {
      const url = new URL(this.page.url());
      url.searchParams.set(selection.param, formatDateToken(values.date, selection.format));
      await this.goto(url.toString(), `${report.id}:date`);
    } else if (selection.mode === "click") {
      const { locator, name } = this.locate(selection.target, values);
      await this.pace();
      await safeClick(locator, name);
      await this.settle();
    } else {
      const input = this.field(selection.label);
      if (!(await input.count())) {
        throw new PortalError("layout", `${report.id}:date`, `The date filter on the “${report.label}” page was not found. The portal layout may have changed.`);
      }
      await input.fill(formatDateToken(values.date, selection.format));
      const { locator, name } = this.locate(selection.apply, values);
      await this.pace();
      await safeClick(locator, name);
      await this.settle();
    }
  }

  /** Navigates to one report for one franchise and date, and collects its document(s). */
  async collectReport(report: PortalReport, fd: string, date: ISODate): Promise<CollectedDocument[]> {
    const values: TemplateValues = { fd, date, period: null };
    await this.runSteps(report.navigate, values, `${report.id}:navigate`);
    await this.selectDate(report, values);
    const stem = `${report.id}_${fd.replace(/[^A-Za-z0-9]+/g, "-")}_${date}`;
    const sourceRef = `${new URL(this.page.url()).pathname} (${report.label})`;

    if (report.collect.mode === "download") {
      const { locator, name } = this.locate(report.collect.trigger, values);
      if (!(await locator.count())) {
        throw new PortalError("layout", `${report.id}:download`, `“${name}” was not found on the “${report.label}” page. The portal layout may have changed, or there is no report for this date yet.`);
      }
      await this.pace();
      const [download] = await Promise.all([this.page.waitForEvent("download", { timeout: 45_000 }), safeClick(locator, name)]);
      return [await this.readDownload(download, stem, sourceRef)];
    }

    if (report.collect.mode === "links") {
      const links = this.page.getByRole("link", { name: new RegExp(report.collect.namePattern, "i") });
      const count = Math.min(await links.count(), report.collect.max);
      if (count === 0) {
        throw new PortalError("layout", `${report.id}:links`, `No downloadable documents were found on the “${report.label}” page for this date.`);
      }
      const documents: CollectedDocument[] = [];
      for (let i = 0; i < count; i++) {
        const href = await links.nth(i).getAttribute("href");
        if (!href) continue;
        await this.pace();
        // A plain GET through the browser's own session; the guard applies to it like any other request.
        const response = await this.context.request.get(new URL(href, this.page.url()).toString());
        if (!response.ok()) throw new PortalError("network", `${report.id}:links`, `A document on the “${report.label}” page could not be downloaded.`, `HTTP ${response.status()}`);
        const type = response.headers()["content-type"] ?? "application/octet-stream";
        const extension = type.includes("pdf") ? "pdf" : type.includes("csv") ? "csv" : type.includes("sheet") ? "xlsx" : (href.split(".").pop() ?? "bin").slice(0, 5);
        documents.push({ filename: `${stem}_${i + 1}.${extension}`, mimeType: type, bytes: new Uint8Array(await response.body()), sourceRef });
      }
      return documents;
    }

    // On-page table → CSV. The franchise and date are written into the file so the parser can read them back.
    const tables = report.collect.tableName
      ? this.page.getByRole("table", { name: new RegExp(escapeRegExp(report.collect.tableName), "i") })
      : this.page.getByRole("table");
    // The portal draws its tables after the page loads.
    await tables.first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => undefined);
    const tableCount = await tables.count();
    if (tableCount === 0) {
      throw new PortalError("layout", `${report.id}:table`, `The table on the “${report.label}” page was not found. The portal layout may have changed.`);
    }
    const readTable = (index: number) =>
      tables.nth(index).locator("tr").evaluateAll((trs) =>
        trs.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((cell) => (cell as HTMLElement).innerText.replace(/\s+/g, " ").trim())),
      );
    const headerPattern = report.collect.tableHeader ? new RegExp(report.collect.tableHeader, "i") : null;
    const wanted: string[][][] = [];
    if (report.collect.tables === "all") {
      for (let i = 0; i < tableCount; i++) {
        const tableRows = await readTable(i);
        const heading = (tableRows.find((r) => r.length >= 3) ?? []).join("|");
        if (!headerPattern || headerPattern.test(heading)) wanted.push(tableRows);
      }
      if (wanted.length === 0) throw new PortalError("layout", `${report.id}:table`, `No table on the “${report.label}” page matched the expected headings. The portal layout may have changed.`);
    } else {
      wanted.push(await readTable(0));
    }
    let rows = wanted.flat();
    // A silent failure of the period drop-down leaves the page on a different period, and its rows would be filed under the wrong one.
    if (values.period && !tableShowsPeriod(rows, values.period)) {
      throw new PortalError("layout", `${report.id}:period`, `The “${report.label}” page did not change to the period ${values.period.start} to ${values.period.end}, so nothing was imported from it. It will be tried again.`);
    }
    try {
      rows = transformTable(rows, report.collect.transform, values);
    } catch (error) {
      throw new PortalError("layout", `${report.id}:table`, `The table on the “${report.label}” page could not be read in the expected shape. The portal layout may have changed.`, (error as Error).message);
    }
    const csvCell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
    const [yyyy, mm, dd] = date.split("-");
    const lines = [`Franchise: ${fd},Report date: ${dd}/${mm}/${yyyy}`, ...rows.filter((r) => r.length > 0).map((r) => r.map(csvCell).join(","))];
    return [{ filename: `${stem}.csv`, mimeType: "text/csv", bytes: new Uint8Array(Buffer.from(lines.join("\r\n") + "\r\n", "utf8")), sourceRef }];
  }

  private async readDownload(download: Download, stem: string, sourceRef: string): Promise<CollectedDocument> {
    const failure = await download.failure();
    if (failure) throw new PortalError("network", "download", "A report could not be downloaded from the DPD portal.", failure);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const suggested = download.suggestedFilename() || "report.pdf";
    const extension = (suggested.includes(".") ? suggested.split(".").pop()! : "pdf").toLowerCase().slice(0, 5);
    const mimeType = extension === "pdf" ? "application/pdf" : extension === "csv" ? "text/csv" : extension === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/octet-stream";
    return { filename: `${stem}.${extension}`, mimeType, bytes: new Uint8Array(Buffer.concat(chunks)), sourceRef };
  }

  /** A screenshot for diagnosing a layout change. Stored privately; never taken on the login form. */
  async screenshot(): Promise<Uint8Array | null> {
    if (!this.signedIn) return null;
    try {
      return new Uint8Array(await this.page.screenshot({ fullPage: false, type: "png" }));
    } catch {
      return null;
    }
  }
}
