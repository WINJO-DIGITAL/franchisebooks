"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { syncDpdNow, syncDropboxNow } from "@/lib/actions/sync";
import type { ActionState } from "@/lib/actions/helpers";
import { ActionMessage } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";

const initial: ActionState = { ok: false, message: "" };

export function SyncButtons({ dpdRunning, dropboxRunning, dropboxConnected }: { dpdRunning: boolean; dropboxRunning: boolean; dropboxConnected: boolean }) {
  const [dpdState, dpdAction, dpdPending] = useActionState(syncDpdNow, initial);
  const [dropboxState, dropboxAction, dropboxPending] = useActionState(syncDropboxNow, initial);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <form action={dpdAction}>
          <Button type="submit" variant="secondary" disabled={dpdPending || dpdRunning}>
            <RefreshCw className={`size-4 ${dpdPending || dpdRunning ? "animate-spin" : ""}`} aria-hidden />
            {dpdPending ? "Starting…" : dpdRunning ? "DPD sync running…" : "Sync DPD"}
          </Button>
        </form>
        {dropboxConnected ? (
          <form action={dropboxAction}>
            <Button type="submit" variant="secondary" disabled={dropboxPending || dropboxRunning}>
              <RefreshCw className={`size-4 ${dropboxPending || dropboxRunning ? "animate-spin" : ""}`} aria-hidden />
              {dropboxPending ? "Checking Dropbox…" : "Sync Dropbox"}
            </Button>
          </form>
        ) : null}
      </div>
      {dpdState.message ? <div className="mt-3"><ActionMessage state={dpdState} /></div> : null}
      {dropboxState.message ? <div className="mt-3"><ActionMessage state={dropboxState} /></div> : null}
    </div>
  );
}
