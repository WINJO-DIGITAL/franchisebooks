import { expect, test } from "@playwright/test";
import { lastCompletedPeriod } from "@/lib/finance/periods";
import { londonToday } from "@/lib/dates";

// Runs as the synthetic demo owner. The demo drivers start with no pay rates.
test.describe.configure({ mode: "serial" });

test.describe("launch fixes (synthetic demo data)", () => {
  test("the dashboard talks about pay periods and lists the drivers who still need a pay rate", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Generate Pay Period Report" })).toBeVisible();
    await expect(page.getByText("Generate Monthly Report")).toHaveCount(0);
    const checklist = page.getByTestId("setup-checklist");
    await expect(checklist).toBeVisible();
    await expect(checklist.getByText(/Set the pay rate for \d+ drivers?/)).toBeVisible();
    await expect(checklist.getByRole("link", { name: "Blake Sample" })).toBeVisible();
    await expect(checklist.getByRole("link", { name: /Set pay rates/ })).toHaveAttribute("href", "/drivers");
  });

  test("driver statements: made for drivers with a pay rate, downloadable one by one and as a zip, with the reason for the rest", async ({ page }) => {
    // Give Alex a day rate (once; a later run finds it already set).
    await page.goto("/drivers");
    await page.getByRole("link", { name: "Alex Example" }).first().click();
    await expect(page.getByRole("heading", { name: "Alex Example" })).toBeVisible();
    if (await page.getByText("£150.00").count() === 0) {
      await page.getByRole("button", { name: "Set Pay Rate" }).click();
      await page.getByLabel("Amount (£)").fill("150");
      await page.getByLabel("Applies from").fill("2026-01-05");
      await page.getByRole("button", { name: "Save Pay Rate" }).click();
      await expect(page.getByText("£150.00").first()).toBeVisible();
    }

    const period = lastCompletedPeriod(londonToday());
    await page.goto(`/reports?statements=${period.start}`);
    await expect(page.getByRole("heading", { name: "Driver Statements" })).toBeVisible();
    await page.getByRole("button", { name: /Make Statements (Now|Again)/ }).click();
    await expect(page.getByText(/driver statements? made for/).first()).toBeVisible({ timeout: 60_000 });

    const table = page.getByTestId("driver-statements");
    const alex = table.getByRole("row", { name: /Alex Example/ });
    await expect(alex.getByRole("link", { name: "Download PDF" })).toBeVisible();
    await expect(alex).toContainText(/FD-DEMO-1-\d{4}P\d{1,2}-D\d{3}/);
    await expect(table.getByRole("row", { name: /Blake Sample/ })).toContainText("No pay rate set");

    const pdf = await page.request.get((await alex.getByRole("link", { name: "Download PDF" }).getAttribute("href"))!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    const zip = await page.request.get((await page.getByRole("link", { name: "Download All (Zip)" }).getAttribute("href"))!);
    expect(zip.status()).toBe(200);
    expect(zip.headers()["content-type"]).toBe("application/zip");
    expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");
    // Nothing is emailed unless the owner presses the button.
    await expect(alex.getByRole("button", { name: "Email to driver" })).toBeVisible();
  });

  test("expenses show subtotals by category and keep VAT-not-stated costs on their own line", async ({ page }) => {
    await page.goto("/expenses");
    await expect(page.getByText("VAT Not Stated", { exact: true })).toBeVisible();
    await expect(page.getByText("Total Spent", { exact: true })).toBeVisible();
    const categories = page.getByTestId("category-subtotals");
    await expect(categories).toBeVisible();
    await expect(categories.getByRole("row", { name: /Fuel/ })).toBeVisible();
  });
});
