# Development log

_Living document. Updated at the end of each phase._

## Status at a glance

| Phase | State |
| --- | --- |
| 1. Discovery and architecture | Done (portal inspection itself is blocked on credentials — see below) |
| 2. Foundation | In progress |
| 3. Core application | Pending |
| 4. Integrations | Pending (import pipeline done) |
| 5. Financial intelligence | Pending (engine and database rules done) |
| 6. Reporting | Pending |
| 7. Quality assurance | Ongoing — tests are written alongside each part |
| 8. Deployment | Pending |

## Completed

* Environment inspection, discovery report, architecture (`docs/`).
* Supabase schema, integrity guards, audit triggers, RLS, RPC functions,
  storage buckets (`supabase/migrations/`).
* Money and UK date utilities; central finance engine; anomaly detection.
* Document extraction (PDF/CSV/XLSX), parsers, matching, import pipeline.
* Job queue helpers and schedule decision logic.
* Tests: unit (finance, anomalies, parsing, matching, money, dates),
  database (security + financial rules), integration (pipeline end to end).

## Blocked on external input

* **DPD portal**: no credentials → portal not inspected; portal map not
  written; real sync untested.
* **Dropbox**: no app key/secret → OAuth and sync untested against the real API.
* **Production Supabase project**: organisation is on the Free plan with both
  project slots used.

## Next step

Build the UI (auth, layout, dashboard, drivers, earnings, expenses,
adjustments, reports, data & integrations, settings).
