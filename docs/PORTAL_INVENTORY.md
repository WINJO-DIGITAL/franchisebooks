# DPD partner portal — capability inventory

**Status: not yet verified.** No authorised credentials were available when
this was written, so nothing below has been observed. This file records what
needs to be established; it deliberately does not guess. Running
`npm run dpd:discover` with credentials writes the observed inventory to
`docs/PORTAL_INVENTORY.generated.md`, after which this table should be
completed from it.

| Section | What information is available | Accessible automatically | Has history | Downloadable | Value to the dashboard |
| --- | --- | --- | --- | --- | --- |
| Daily earnings | Not verified | Not verified | Not verified | Not verified | Core — drives driver pay and performance |
| Driver performance | Not verified | Not verified | Not verified | Not verified | High if present |
| Parcel volumes | Not verified | Not verified | Not verified | Not verified | High (also read from earnings reports if they carry it) |
| Completed stops | Not verified | Not verified | Not verified | Not verified | High (as above) |
| Fuel card information | Not verified | Not verified | Not verified | Not verified | High — fuel is a major cost |
| Fuel transactions | Not verified | Not verified | Not verified | Not verified | High |
| Expenses | Not verified | Not verified | Not verified | Not verified | High |
| Adjustments and deductions | Not verified | Not verified | Not verified | Not verified | High — affects pay accuracy |
| Franchise performance / revenue | Not verified | Not verified | Not verified | Not verified | Critical for profit — see open question 1 in DISCOVERY.md |
| Historical reports | Not verified | Not verified | Not verified | Not verified | Needed to back-fill history for anomaly baselines |
| Vehicle information | Not verified | Not verified | Not verified | Not verified | Medium — improves fuel attribution |
| Driver information | Not verified | Not verified | Not verified | Not verified | Medium — driver references improve matching |
| Route information | Not verified | Not verified | Not verified | Not verified | Medium |
| Operational exceptions | Not verified | Not verified | Not verified | Not verified | Medium |
| Other downloadable reports | Not verified | Not verified | Not verified | Not verified | To be assessed |

## What the app can already ingest, whatever the portal turns out to offer

Independently of the portal, the import pipeline accepts PDF, CSV and Excel
documents containing a table of **driver earnings**, **fuel transactions** or
**expenses**, recognised by their column headings. Anything it does not
recognise or cannot read with confidence goes to the owner's review queue
rather than being stored.
