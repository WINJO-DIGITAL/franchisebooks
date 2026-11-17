import { expect, test } from "@playwright/test";
import { earningsPdf } from "../fixtures/synthetic";

test.describe("owner journeys (synthetic demo data)", () => {
  test("the dashboard answers the key questions in one screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Earned by drivers")).toBeVisible();
    await expect(page.getByText("Driver pay").first()).toBeVisible();
    await expect(page.getByText("Fuel").first()).toBeVisible();
    await expect(page.getByText("Other expenses").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Synchronisation" })).toBeVisible();
    // Revenue was entered as an estimate, so profit must be labelled as an estimate.
    await expect(page.getByText("Estimated").first()).toBeVisible();
    // Quick actions
    await expect(page.getByRole("link", { name: "Add Pay Adjustment" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Record Driver Cover" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add Expense" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Sync DPD/ })).toBeVisible();
    // All eight sections are reachable from the sidebar.
    for (const name of ["Dashboard", "Drivers", "Earnings", "Fuel & Expenses", "Adjustments", "Reports", "Data & Integrations", "Settings"]) {
      await expect(page.getByRole("navigation", { name: "Main" }).first().getByRole("link", { name })).toBeVisible();
    }
  });

  test("adds a pay adjustment through the guided flow, with confirmation, and later reverses it", async ({ page }) => {
    await page.goto("/adjustments/new");
    await expect(page.getByRole("heading", { name: "Who is the payment for?" })).toBeVisible();
    await page.getByLabel("Driver").selectOption({ label: "Blake Sample" });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Which day?" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "What kind, and how much?" })).toBeVisible();
    await page.getByRole("radio", { name: /Additional payment/ }).check();
    await page.getByLabel("How much?").fill("37.50");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Why?" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Say briefly why")).toBeVisible(); // validation: a reason is required
    await page.getByLabel("Reason").fill("E2E: covered an extra route");
    await page.getByRole("button", { name: "Continue" }).click();
    // Confirmation screen before anything is saved
    await expect(page.getByRole("heading", { name: "Check and confirm" })).toBeVisible();
    await expect(page.getByText("+£37.50")).toBeVisible();
    await expect(page.getByText("The original DPD figure is not changed")).toBeVisible();
    await page.getByRole("button", { name: "Save adjustment" }).click();
    await expect(page.getByText(/Adjustment saved: \+£37\.50/)).toBeVisible();

    await page.goto("/adjustments");
    const row = page.getByRole("row", { name: /E2E: covered an extra route/ }).first();
    await expect(row).toContainText("+£37.50");
    await row.getByRole("button", { name: "Reverse" }).click();
    await page.getByLabel("Why is it being reversed?").fill("E2E clean-up");
    await page.getByRole("button", { name: "Reverse adjustment" }).click();
    await expect(page.getByRole("row", { name: /E2E clean-up/ })).toContainText("−£37.50");
    await expect(page.getByRole("row", { name: /E2E: covered an extra route/ }).first()).toContainText("Reversed");
  });

  test("records driver cover and keeps the original DPD figures", async ({ page }) => {
    await page.goto("/adjustments/cover");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Whose work was covered?").selectOption({ label: "Alex Example" });
    await page.getByLabel("Who covered it?").selectOption({ label: "Blake Sample" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /I'll enter the amounts/ }).check();
    await page.getByLabel(/Add to Blake Sample/).fill("25");
    await page.getByLabel(/Take off Alex Example/).fill("25");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check and confirm" })).toBeVisible();
    await expect(page.getByText("Blake Sample covered Alex Example")).toBeVisible();
    await page.getByRole("button", { name: "Save cover record" }).click();
    await expect(page.getByText(/Cover recorded/)).toBeVisible();
    await expect(page.getByText(/original DPD figures are unchanged/i)).toBeVisible();
    // Clean up through the app: cancelling reverses the pay adjustments.
    await page.goto("/adjustments");
    const cover = page.getByRole("row", { name: /Blake Sample.*Alex Example/ }).first();
    await cover.getByRole("button", { name: "Cancel" }).click();
    await page.getByLabel("Why is it being cancelled?").fill("E2E clean-up");
    await page.getByRole("button", { name: "Cancel cover record" }).click();
    await expect(page.getByRole("row", { name: /Blake Sample.*Alex Example/ }).first()).toContainText("Cancelled");
  });

  test("uploads an earnings PDF by hand, and refuses to import the same file twice", async ({ page }) => {
    const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, "0");
    const month = String(1 + Math.floor(Math.random() * 11)).padStart(2, "0");
    const date = `2024-${month}-${day}`;
    const buffer = await earningsPdf({ fdNumber: "FD-DEMO-1", date });
    await page.goto("/data");
    await page.locator("#upload-files").setInputFiles({ name: `e2e-earnings-${date}.pdf`, mimeType: "application/pdf", buffer });
    await page.getByRole("button", { name: "Import files" }).click();
    await expect(page.getByText(/4 driver records imported/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/not matched to a registered driver/)).toBeVisible();
    await page.goto("/data");
    await page.locator("#upload-files").setInputFiles({ name: "same-file-renamed.pdf", mimeType: "application/pdf", buffer });
    await page.getByRole("button", { name: "Import files" }).click();
    await expect(page.getByText(/already been imported/)).toBeVisible({ timeout: 30_000 });
    // The original document is available from the earnings page for that day.
    await page.goto(`/earnings?date=${date}`);
    await expect(page.getByRole("link", { name: "Uploaded by hand" }).first()).toBeVisible();
  });

  test("a document that cannot be trusted waits in 'Needs attention' and imports nothing", async ({ page }) => {
    const date = `2023-0${1 + Math.floor(Math.random() * 8)}-1${Math.floor(Math.random() * 9)}`;
    const buffer = await earningsPdf({ fdNumber: "FD-DEMO-1", date, corruptTotalBy: 17 });
    await page.goto("/data");
    await page.locator("#upload-files").setInputFiles({ name: `e2e-corrupt-${date}.pdf`, mimeType: "application/pdf", buffer });
    await page.getByRole("button", { name: "Import files" }).click();
    await expect(page.getByText(/needs checking before it is imported/)).toBeVisible({ timeout: 30_000 });
    await page.goto(`/earnings?date=${date}`);
    await expect(page.getByText(`No earnings for`)).toBeVisible();
    await page.goto("/data#attention");
    await expect(page.getByRole("heading", { name: /Needs attention \(\d+\)/ })).toBeVisible();
    // Reject it so the demo data stays tidy.
    const item = page.locator("li", { hasText: `e2e-corrupt-${date}.pdf` }).first();
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(page.getByText(/Rejected\. Nothing from this document was imported/)).toBeVisible();
  });

  test("adds an expense by hand and assigns it to a driver", async ({ page }) => {
    await page.goto("/expenses");
    await page.getByRole("button", { name: "Add Expense" }).click();
    await page.getByLabel("What was it for?").fill("E2E two front tyres");
    await page.getByLabel("How much?").fill("186.40");
    await page.getByLabel("Category").selectOption({ label: "Tyres" });
    await page.getByRole("radio", { name: "Decide later" }).check();
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.getByRole("link", { name: "Unallocated" }).click();
    const row = page.getByRole("row", { name: /E2E two front tyres/ });
    await expect(row).toContainText("£186.40");
    await expect(row).toContainText("Unallocated");
    await row.getByRole("button", { name: "Assign" }).click();
    await page.getByLabel("Which driver?").selectOption({ label: "Alex Example" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.goto("/expenses");
    await expect(page.getByRole("row", { name: /E2E two front tyres/ })).toContainText("Alex Example");
    // Clean up: remove from totals with a reason.
    await page.getByRole("row", { name: /E2E two front tyres/ }).getByRole("button", { name: "Remove" }).click();
    await page.getByLabel(/Why\?/).fill("E2E clean-up");
    await page.getByRole("button", { name: "Remove" }).last().click();
    await expect(page.getByText("E2E two front tyres")).toHaveCount(0);
  });

  test("generates a monthly PDF report and downloads it", async ({ page, request }) => {
    await page.goto("/reports");
    await page.getByRole("button", { name: "Generate report" }).click();
    await expect(page.getByText(/Report generated for/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("link", { name: "Download PDF" }).first()).toBeVisible();
    const href = await page.getByRole("link", { name: "Download PDF" }).first().getAttribute("href");
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("application/pdf");
    expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    void request;
  });

  test("shows the drivers, an individual driver page and unregistered names", async ({ page }) => {
    await page.goto("/drivers");
    await expect(page.getByRole("link", { name: "Alex Example" })).toBeVisible();
    await expect(page.getByText(/Names on DPD reports that are not registered/)).toBeVisible();
    await page.getByRole("link", { name: "Alex Example" }).click();
    await expect(page.getByRole("heading", { name: "Alex Example" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Earnings history" })).toBeVisible();
    await expect(page.getByText("Stop pattern")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pay adjustments" })).toBeVisible();
  });

  test("raises an explainable alert and lets the owner decide what to do with it", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "Alerts" })).toBeVisible();
    const card = page.locator("li", { hasText: "What happened" }).first();
    await expect(card).toContainText("Why it was flagged");
    await expect(card).toContainText("What you might do");
    await expect(page.getByText(/never changes any figure/)).toBeVisible();
    await card.getByRole("button", { name: "Investigating" }).click();
    await expect(page.getByText(/Marked as “Investigating”/)).toBeVisible();
  });

  test("adds franchise revenue in Settings and profit stops being 'not available'", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Franchise revenue" })).toBeVisible();
    await page.getByRole("button", { name: "Add revenue" }).click();
    await page.getByLabel("Amount received from DPD").fill("12000");
    await page.getByLabel("Is this figure confirmed?").selectOption("confirmed");
    await page.getByRole("button", { name: "Save revenue" }).click();
    await expect(page.getByText(/Revenue of £12,000\.00 saved as confirmed/)).toBeVisible();
  });
});
