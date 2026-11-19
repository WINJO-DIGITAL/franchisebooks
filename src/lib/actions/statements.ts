"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { periodContaining, periodLabel } from "@/lib/finance/periods";
import { sendEmail } from "@/lib/notify/email";
import { generateDriverStatements, statementRunSummary } from "@/lib/statements/generate";
import { statementFileName } from "@/lib/statements/numbering";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, parseForm, unexpectedFailure, type ActionState } from "./helpers";
import { isoDate, optionalUuid, uuid } from "./schemas";

const makeSchema = z.object({ periodStart: isoDate, franchiseId: optionalUuid });

/** Makes (or makes again) the driver statements for a pay period, for one franchise or every franchise this login can see. */
export async function makeDriverStatements(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.canWrite) return fail("You do not have permission to make driver statements.");
  const parsed = parseForm(makeSchema, formData);
  if ("error" in parsed) return parsed.error;
  const period = periodContaining(parsed.data.periodStart);
  if (period.end >= ctx.today) return fail(`The period ${periodLabel(period)} has not closed yet. Statements are made once it has.`);
  // ctx.franchises holds only the franchises this login may see.
  const targets = parsed.data.franchiseId
    ? ctx.franchises.filter((f) => f.id === parsed.data.franchiseId)
    : ctx.franchises.filter((f) => f.isActive || f.id === ctx.franchiseId);
  if (targets.length === 0) return fail("Choose a franchise you can see.");
  try {
    const db = createAdminClient();
    const made: string[] = [];
    let skipped = 0;
    for (const f of targets) {
      const run = await generateDriverStatements(db, { accountId: ctx.accountId, franchiseId: f.id, period, trigger: "manual", userId: ctx.userId });
      skipped += run.skipped.length;
      if (run.made.length + run.skipped.length > 0) made.push(`${f.fdNumber}: ${statementRunSummary(run, period)}`);
    }
    revalidatePath("/reports");
    if (made.length === 0) return fail(`No driver worked in ${periodLabel(period)}, so there are no statements to make.`);
    return ok(skipped > 0 ? `Done, but some drivers have no statement. ${made.join(" ")}` : `Done. ${made.join(" ")}`);
  } catch (error) {
    return unexpectedFailure(error, "The statements could not be made. Nothing was changed.");
  }
}

const emailSchema = z.object({ id: uuid });

/** Emails one statement to its driver. Never automatic: only when the owner presses the button. */
export async function emailDriverStatement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const ctx = await getContext();
  if (!ctx.isOwner) return fail("Only the owner can email statements to drivers.");
  const parsed = parseForm(emailSchema, formData);
  if ("error" in parsed) return parsed.error;
  const { data: statement } = await ctx.supabase.from("driver_statements").select("id, driver_id, storage_path, statement_no, title, period_start, period_end, totals")
    .eq("id", parsed.data.id).maybeSingle();
  if (!statement) return fail("That statement could not be found.");
  const { data: driver } = await ctx.supabase.from("drivers").select("display_name, email").eq("id", statement.driver_id).maybeSingle();
  if (!driver?.email) return fail("This driver has no email address. Add one under Drivers first.");
  const file = await createAdminClient().storage.from("reports").download(statement.storage_path);
  if (file.error || !file.data) return fail("The statement file is no longer available. Make the statements again.");
  const range = periodLabel({ start: statement.period_start, end: statement.period_end });
  const what = statement.title === "Self-billed invoice" ? "self-billed invoice" : "pay statement";
  const sent = await sendEmail({
    to: driver.email,
    subject: `Your ${what} for ${range} (${statement.statement_no})`,
    text: `Hello ${driver.display_name.split(" ")[0]},\n\nYour ${what} for ${range} is attached (${statement.statement_no}).\n\nIf anything looks wrong, please speak to the office before the next pay day.\n\n${ctx.accountName}`,
    attachments: [{ filename: statementFileName(statement.statement_no, driver.display_name), content: Buffer.from(await file.data.arrayBuffer()) }],
  });
  if (!sent) return fail("The email could not be sent. Check email sending is set up, then try again.");
  await createAdminClient().from("driver_statements").update({ emailed_at: new Date().toISOString() }).eq("id", statement.id).eq("account_id", ctx.accountId);
  revalidatePath("/reports");
  return ok(`Emailed to ${driver.email}.`);
}
