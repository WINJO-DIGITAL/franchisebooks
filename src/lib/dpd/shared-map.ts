/**
 * The DPD portal setup shared by every account.
 *
 * DPD's portal looks and works the same for every franchise owner, so one saved description of how to
 * move around it (where Payments, Charges and Invoices are, and how to read them) serves all accounts.
 * Each account only adds its own login. An account can still carry its own map as an override, for the
 * rare owner whose portal differs; without one, this map is used.
 *
 * It lives under src/ (not docs/) so the background worker, which only ships src/ and worker/, has it.
 */

import sharedMapJson from "./portal-map.json";
import { portalMapSchema, type PortalMap } from "./portal-map";

export const SHARED_PORTAL_MAP: PortalMap = portalMapSchema.parse(sharedMapJson);
