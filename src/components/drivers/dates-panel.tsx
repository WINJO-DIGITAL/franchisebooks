"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addComplianceDate, changeComplianceDate, removeComplianceDate } from "@/lib/actions/reminders";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, type Tone } from "@/components/ui/bits";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { DRIVER_KINDS, KIND_LABEL, reminderFor, reminderText, VEHICLE_KINDS, type DateStatus } from "@/lib/compliance/dates";
import { formatUkDate, type ISODate } from "@/lib/dates";

export interface DateRow {
  id: string;
  subjectType: "driver" | "vehicle";
  /** The driver's name, or the vehicle registration. */
  subject: string;
  kind: string;
  label: string | null;
  expiresOn: ISODate;
  notes: string | null;
}

const TONE: Record<DateStatus, Tone> = { overdue: "bad", due_soon: "warn", current: "neutral" };

export function DatesPanel({ rows, drivers, today, canWrite }: { rows: DateRow[]; drivers: { id: string; name: string }[]; today: ISODate; canWrite: boolean }) {
  const router = useRouter();
  const [subject, setSubject] = useState<"driver" | "vehicle">("driver");
  const [kind, setKind] = useState<string>(DRIVER_KINDS[0]);
  const kinds = subject === "driver" ? DRIVER_KINDS : VEHICLE_KINDS;
  const kindChoice = (kinds as readonly string[]).includes(kind) ? kind : kinds[0];

  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No dates yet. Add a driver&rsquo;s licence, right to work or DBS date, or a van&rsquo;s MOT, service, road tax or insurance.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {rows.map((r) => {
            const reminder = reminderFor(r.expiresOn, today);
            const what = r.kind.endsWith("_other") || r.kind === "vehicle_other" ? (r.label ?? KIND_LABEL[r.kind as keyof typeof KIND_LABEL]) : KIND_LABEL[r.kind as keyof typeof KIND_LABEL];
            return (
              <li key={r.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="font-medium">{what} <span className="font-normal text-muted">· {r.subject}</span></p>
                  <p className="text-sm text-muted">Expires {formatUkDate(r.expiresOn)}{r.notes ? ` · ${r.notes}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge tone={TONE[reminder.status]}>{reminderText(reminder)}</Badge>
                  {canWrite ? (
                    <>
                      <ActionForm action={changeComplianceDate} className="flex items-center gap-1" onSuccess={() => router.refresh()}>
                        <input type="hidden" name="id" value={r.id} />
                        <label className="sr-only" htmlFor={`date-${r.id}`}>New expiry date</label>
                        <Input id={`date-${r.id}`} name="expiresOn" type="date" defaultValue={r.expiresOn} className="h-9 w-40" />
                        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">Change</SubmitButton>
                      </ActionForm>
                      <ActionForm action={removeComplianceDate} onSuccess={() => router.refresh()}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton variant="quiet" size="sm" pendingLabel="Removing…">Remove</SubmitButton>
                      </ActionForm>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <ActionForm action={addComplianceDate} className="grid gap-4 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2" resetOnSuccess onSuccess={() => router.refresh()}>
          {(state) => (
            <>
              <Field label="Who Or What?">
                <Select name="subjectType" value={subject} onChange={(e) => { setSubject(e.target.value as "driver" | "vehicle"); setKind(""); }}>
                  <option value="driver">A Driver</option>
                  <option value="vehicle">A Vehicle</option>
                </Select>
              </Field>
              {subject === "driver" ? (
                <Field label="Driver" error={state.fieldErrors?.driverId}>
                  <Select name="driverId" defaultValue="">
                    <option value="" disabled>Choose a driver</option>
                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="Registration" error={state.fieldErrors?.vehicleRegistration} hint="For example AB12 CDE">
                  <Input name="vehicleRegistration" autoCapitalize="characters" />
                </Field>
              )}
              <Field label="Date Type" error={state.fieldErrors?.kind}>
                <Select name="kind" value={kindChoice} onChange={(e) => setKind(e.target.value)}>
                  {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </Select>
              </Field>
              <Field label="Expires On" error={state.fieldErrors?.expiresOn}>
                <Input name="expiresOn" type="date" required />
              </Field>
              {kindChoice.endsWith("_other") ? (
                <Field label="What Is It?" error={state.fieldErrors?.label}>
                  <Input name="label" maxLength={120} />
                </Field>
              ) : null}
              <Field label="Notes (Optional)" className="sm:col-span-2" error={state.fieldErrors?.notes}>
                <Textarea name="notes" rows={2} maxLength={1000} />
              </Field>
              <div className="sm:col-span-2"><SubmitButton pendingLabel="Saving…">Save Date</SubmitButton></div>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}
