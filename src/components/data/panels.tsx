"use client";

import { useActionState, useState } from "react";
import { FolderOpen, Upload } from "lucide-react";
import { decideReview, resolveConflict, uploadDocuments } from "@/lib/actions/imports";
import {
  addDropboxFolder, disconnectDropbox, exploreDpdPortal, listDropboxFolders, removeDropboxFolder, savePortalMap, syncDropboxNow,
} from "@/lib/actions/sync";
import type { ActionState } from "@/lib/actions/helpers";
import { ActionForm, ActionMessage, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form";

const initial: ActionState = { ok: false, message: "" };

/** Drag-and-drop upload area. Uses the same import pipeline (and duplicate rules) as the automatic sources. */
export function UploadArea({ franchises, defaultFranchiseId }: { franchises: { id: string; label: string }[]; defaultFranchiseId: string | null }) {
  const [state, action, pending] = useActionState(uploadDocuments, initial);
  const [names, setNames] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  return (
    <form action={action}>
      <label
        htmlFor="upload-files"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const input = document.getElementById("upload-files") as HTMLInputElement | null;
          if (input && e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            setNames([...e.dataTransfer.files].map((f) => f.name));
          }
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-sunken/50"}`}
      >
        <Upload className="size-7 text-muted" aria-hidden />
        <span className="font-medium">Drop PDF, CSV or Excel files here</span>
        <span className="text-sm text-muted">or click to choose files · up to 20 files, 20 MB each</span>
        {names.length ? <span className="mt-2 text-sm text-ink-soft">{names.length === 1 ? names[0] : `${names.length} files selected`}</span> : null}
      </label>
      <input id="upload-files" name="files" type="file" multiple accept=".pdf,.csv,.tsv,.xlsx,.xlsm,application/pdf,text/csv" className="sr-only" onChange={(e) => setNames([...(e.target.files ?? [])].map((f) => f.name))} />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {franchises.length > 1 ? (
          <Field label="Franchise (if the document does not say)" className="min-w-60">
            <Select name="franchiseId" defaultValue={defaultFranchiseId ?? ""}>
              <option value="">Let the system decide</option>
              {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
        ) : <input type="hidden" name="franchiseId" value={franchises[0]?.id ?? ""} />}
        <Button type="submit" disabled={pending || names.length === 0}>{pending ? "Importing…" : "Import files"}</Button>
      </div>
      {state.message ? <div className="mt-3"><ActionMessage state={state} /></div> : null}
    </form>
  );
}

function SimpleAction({ action, label, variant = "secondary", confirmText }: { action: (p: ActionState, f: FormData) => Promise<ActionState>; label: string; variant?: "secondary" | "danger" | "primary"; confirmText?: string }) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <div>
      <form action={formAction} onSubmit={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}>
        <Button type="submit" variant={variant} disabled={pending}>{pending ? "Working…" : label}</Button>
      </form>
      {state.message ? <div className="mt-3"><ActionMessage state={state} /></div> : null}
    </div>
  );
}

export const SyncDropboxButton = () => <SimpleAction action={syncDropboxNow} label="Sync Dropbox" />;
export const DisconnectDropboxButton = () => <SimpleAction action={disconnectDropbox} label="Disconnect" variant="danger" confirmText="Disconnect Dropbox? Documents already imported are kept." />;
export const ExplorePortalButton = () => <SimpleAction action={exploreDpdPortal} label="Explore the DPD portal (read-only)" />;

export function RemoveFolderButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(removeDropboxFolder, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="quiet" size="sm" disabled={pending}>Stop Watching</Button>
      {state.message && !state.ok ? <p className="mt-1 text-sm text-bad">{state.message}</p> : null}
    </form>
  );
}

/** Folder browser: walks the owner's Dropbox one level at a time. */
export function AddFolderDialog({ franchises }: { franchises: { id: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState<{ path: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next: string) {
    setLoading(true);
    setError(null);
    const result = await listDropboxFolders(next);
    setLoading(false);
    if (!result.ok) return setError(result.message ?? "The folders could not be loaded.");
    setPath(next);
    setFolders(result.folders);
  }
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  return (
    <>
      <Button variant="secondary" onClick={() => { setOpen(true); void load(""); }}><FolderOpen className="size-4" aria-hidden />Choose a folder to watch</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Choose a Dropbox Folder" wide>
        <ActionForm action={addDropboxFolder} className="space-y-4" onSuccess={() => setOpen(false)}>
          {(state) => (
            <>
              <input type="hidden" name="path" value={path} />
              <p className="text-sm text-muted">Currently looking in: <strong className="text-ink">{path || "Your Dropbox"}</strong></p>
              {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}
              <ul className="max-h-64 overflow-y-auto rounded-lg border border-line">
                {path ? <li className="border-b border-line"><button type="button" className="w-full px-3 py-2.5 text-left text-sm font-medium text-accent hover:bg-sunken" onClick={() => void load(parent)}>← Back</button></li> : null}
                {loading ? <li className="px-3 py-3 text-sm text-muted">Loading…</li> : folders.length === 0 ? <li className="px-3 py-3 text-sm text-muted">No folders in here.</li> : folders.map((f) => (
                  <li key={f.path} className="border-b border-line last:border-0"><button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-sunken" onClick={() => void load(f.path)}><FolderOpen className="size-4 text-muted" aria-hidden />{f.name}</button></li>
                ))}
              </ul>
              {franchises.length > 0 ? (
                <Field label="Documents in this folder belong to…" hint="Used when a document does not name its franchise.">
                  <Select name="franchiseId" defaultValue="">
                    <option value="">Work it out from each document</option>
                    {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                  </Select>
                </Field>
              ) : null}
              {state.fieldErrors?.path ? <p className="text-sm text-bad">Open a folder first, then press the button.</p> : null}
              <SubmitButton disabled={!path}>Watch “{path || "…"}”</SubmitButton>
            </>
          )}
        </ActionForm>
      </Dialog>
    </>
  );
}

/** Approve or reject a document held back for checking. */
export function ReviewActions({ id, needsFranchise, franchises, canApprove }: { id: string; needsFranchise: boolean; franchises: { id: string; label: string }[]; canApprove: boolean }) {
  const [state, action, pending] = useActionState(decideReview, initial);
  return (
    <form action={action} className="mt-3 border-t border-line pt-3">
      <input type="hidden" name="id" value={id} />
      {needsFranchise ? (
        <Field label="Which franchise is this for?" className="mb-3 max-w-sm">
          <Select name="franchiseId" defaultValue="" required>
            <option value="" disabled>Choose…</option>
            {franchises.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </Select>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canApprove ? <Button type="submit" name="decision" value="accept" size="sm" disabled={pending}>Figures Are Correct: Import Them</Button> : null}
        <Button type="submit" name="decision" value="reject" size="sm" variant="secondary" disabled={pending}>Reject</Button>
      </div>
      {state.message ? <div className="mt-3"><ActionMessage state={state} /></div> : null}
    </form>
  );
}

/** Two documents disagree: the owner chooses which figures to keep. */
export function ConflictActions({ id }: { id: string }) {
  const [state, action, pending] = useActionState(resolveConflict, initial);
  return (
    <form action={action} className="mt-3 border-t border-line pt-3">
      <input type="hidden" name="id" value={id} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="choice" value="keep_existing" size="sm" disabled={pending}>Keep the Figures Already Stored</Button>
        <Button type="submit" name="choice" value="use_incoming" size="sm" variant="secondary" disabled={pending}>Use the Newer Document&rsquo;s Figures</Button>
      </div>
      <p className="mt-2 text-sm text-muted">Either way, nothing is deleted: replaced figures stay on record.</p>
      {state.message ? <div className="mt-3"><ActionMessage state={state} /></div> : null}
    </form>
  );
}

export function PortalMapForm({ current }: { current: string }) {
  return (
    <ActionForm action={savePortalMap} className="space-y-3">
      {(state) => (
        <>
          <Field label="DPD portal setup (JSON)" hint="Produced from the portal exploration and reviewed by your developer. Leave empty to turn automatic DPD sync off." error={state.fieldErrors?.portalMap}>
            <Textarea name="portalMap" defaultValue={current} className="min-h-48 font-mono text-xs" spellCheck={false} />
          </Field>
          <SubmitButton>Save Portal Setup</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
