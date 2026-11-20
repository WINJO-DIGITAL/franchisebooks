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

  test("a franchise's sliding scale is chosen from the DPD list, with each scale's active date, and is remembered", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Edit" }).first().click();
    const dialog = page.getByRole("dialog");
    const select = dialog.getByLabel("Sliding scale");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).toHaveCount(34); // "Not chosen yet" and the 33 scales
    await expect(select.locator("option").nth(1)).toHaveText("ODF e-Micro · 01/01/1970");
    await select.selectOption({ label: "ODF e-Lite - Maxus 72KWH · 31/05/2021" });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden(); // saved: the form closes
    await page.reload();
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByRole("dialog").getByLabel("Sliding scale")).toHaveValue("electric-maxus-72kwh");
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

test.describe("documents the sync could not read (synthetic demo data)", () => {
  test("the owner sees them under Data & Integrations and can open the original PDF through a short-lived link", async ({ page }) => {
    // Stand in for a night where DPD sent a document that could not be read (local database only).
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: franchise } = await admin.from("franchises").select("id, account_id, fd_number").eq("fd_number", "FD-DEMO-1").single();
    const path = `${franchise!.account_id}/invoices/${franchise!.fd_number}/FVI-DEMO-1.pdf`;
    await admin.storage.from("diagnostics").upload(path, new TextEncoder().encode("%PDF-1.4\nsynthetic\n%%EOF"), { contentType: "application/pdf", upsert: true });
    await admin.from("unreadable_documents").upsert({
      account_id: franchise!.account_id, franchise_id: franchise!.id, document_no: "FVI-DEMO-1", status: "unreadable",
      reason: "Invoice FVI-DEMO-1 for FD-DEMO-1 could not be read (no billing period found), so it was not stored.", pdf_path: path, resolved_at: null,
    }, { onConflict: "account_id,document_no" });

    await page.goto("/data");
    const table = page.getByTestId("unreadable-documents");
    await expect(table).toBeVisible();
    const row = table.getByRole("row", { name: /FVI-DEMO-1/ });
    await expect(row).toContainText("No billing period found");
    const href = await row.getByRole("link", { name: "View" }).getAttribute("href");
    const first = await page.request.get(href!, { maxRedirects: 0 });
    expect(first.status()).toBe(303);
    expect(first.headers()["location"]).toMatch(/\/storage\/v1\/object\/sign\/diagnostics\/.+token=/);
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

test.describe("one-off DPD payments (synthetic demo data)", () => {
  test("a support payment and its VAT-only invoice show as one income line in their pay period", async ({ page }) => {
    expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):/);
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const { data: franchise } = await admin.from("franchises").select("id, account_id").eq("fd_number", "FD-DEMO-1").single();
    const base = { account_id: franchise!.account_id, franchise_id: franchise!.id, reconciled: true, problems: [] };
    await admin.from("dpd_invoices").upsert([
      { ...base, invoice_no: "FI-DEMO-SP1", kind: "support_payment", invoice_date: "2026-09-13", due_date: "2026-09-18", period_start: "2026-09-13", period_end: "2026-09-13",
        net_total: 500, vat_total: 0, invoice_total: 500, lines: [{ description: "Business start", quantity: 1, rate: "£500.00", amount: 50000, vatCode: null }], refers_to: [] },
      { ...base, invoice_no: "FVI-DEMO-1", kind: "vat_only", invoice_date: "2026-10-11", due_date: "2026-10-16", period_start: "2026-10-11", period_end: "2026-10-11",
        net_total: 0, vat_total: 100, invoice_total: 100, lines: [], refers_to: [{ invoiceNo: "FI-DEMO-SP1", docDate: "2026-09-14", net: 50000, vat: 10000 }] },
    ], { onConflict: "account_id,invoice_no" });

    await page.goto("/earnings?period=2026-08-17");
    const line = page.getByRole("row", { name: /DPD business start support payment/ });
    await expect(line).toBeVisible();
    await expect(line).toContainText("£500.00 + £100.00 VAT = £600.00");
    await expect(line).toContainText("FI-DEMO-SP1 + FVI-DEMO-1");
    // The VAT-only invoice's own period has no second £500.
    await page.goto("/earnings?period=2026-09-14");
    await expect(page.getByText("DPD business start support payment")).toHaveCount(0);
  });
});
