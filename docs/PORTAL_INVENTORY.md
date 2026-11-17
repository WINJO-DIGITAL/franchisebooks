# DPD partner portal — capability inventory

**Status: partly verified (17 November 2026).** The portal is the DPD owner-driver
(ODF) portal at `myportal.drivers.dpd.co.uk`. Observed with the franchise's own
login, read-only. The table below was written before that and is still unverified
except where this section says otherwise.

| Section | Observed |
| --- | --- |
| Your Account → Payments | Per-day, per-driver rows for a four-week period: date, stops, total parcels, excess parcels, stop pay, parcel pay, total, route, mileage, driver. Filters: Routes (FD numbers), Year, Period (13 a year). History back to 2021. A per-period fuel supplement line. Row downloads. **Imported.** |
| Your Account → Charges | Fixed and variable cost lines per period, amounts shown excluding VAT. Same filters. **Imported as expenses.** |
| Your Account → Invoices | Monthly self-billed invoice, DPD invoice and remittance advice (PDF downloads). **Not imported** (no importer). |
| Your Drivers | Driver list with number, status, depot and rating. **Not imported.** |
| Overview, Messages, Help, DPD Media | Compliments and feedback; messages; policy PDFs; videos. Not used. |
| Fuel card, vehicles, routes (as separate pages) | **Not found** in this portal. |

Original, unverified notes follow.

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
