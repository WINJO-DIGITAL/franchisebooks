/**
 * A SYNTHETIC stand-in for a partner portal, used only to test the browser
 * automation engine. It is not a model of DPD's real portal.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { earningsPdf } from "./synthetic";

export interface MockPortalOptions {
  fdNumber: string;
  username?: string;
  password?: string;
  /** Show a verification-code step after login instead of the home page. */
  mfa?: boolean;
  /** Rename the download link, simulating a layout change. */
  downloadLabel?: string;
  /** Serve a PDF whose totals do not match its rows. */
  corruptPdf?: boolean;
  /** Dates for which no report exists. */
  missingDates?: string[];
  /**
   * Show a Payments page with Year and Period drop-downs, like DPD's, listing these period texts
   * (for example "9th November 2026 - 6th December 2026"). Its Year drop-down lists these years.
   */
  periods?: { years: string[]; options: string[] };
}

export interface MockPortal {
  url: string;
  hits: { method: string; path: string }[];
  /** Number of times the (write) approve endpoint was reached. Must stay at zero. */
  writeHits: () => number;
  close: () => Promise<void>;
}

const page = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export async function startMockPortal(options: MockPortalOptions): Promise<MockPortal> {
  const username = options.username ?? "test.user";
  const password = options.password ?? "correct-horse";
  const hits: MockPortal["hits"] = [];
  let writes = 0;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    hits.push({ method: req.method ?? "GET", path: url.pathname });
    const html = (status: number, content: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(content);
    };
    const signedIn = (req.headers.cookie ?? "").includes("sid=ok");

    if (url.pathname === "/login" && req.method === "GET") {
      return html(200, page("Sign in", `<h1>Partner sign in</h1><form method="post" action="/login">
        <label for="u">Username</label><input id="u" name="u"><label for="p">Password</label><input id="p" name="p" type="password">
        <button type="submit">Log in</button></form>`));
    }
    if (url.pathname === "/login" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      if (form.get("u") === username && form.get("p") === password) {
        res.writeHead(302, { location: options.mfa ? "/verify" : "/home", "set-cookie": "sid=ok; Path=/" });
        return res.end();
      }
      return html(200, page("Sign in", `<p>Incorrect username or password.</p><form method="post" action="/login"><label for="u">Username</label><input id="u" name="u"><label for="p">Password</label><input id="p" name="p" type="password"><button type="submit">Log in</button></form>`));
    }
    if (url.pathname === "/verify") return html(200, page("Verify", `<h1>Enter the verification code we sent to your phone</h1><form method="post" action="/verify"><label for="c">Code</label><input id="c" name="c"><button>Continue</button></form>`));
    if (!signedIn) {
      res.writeHead(302, { location: "/login" });
      return res.end();
    }
    if (url.pathname === "/home") {
      return html(200, page("Home", `<nav><a href="/home">Home</a> <a href="/logout">Log out</a></nav><h1>Franchises</h1><ul><li><a href="/franchise/${options.fdNumber}">Franchise ${options.fdNumber}</a></li></ul>`));
    }
    if (url.pathname === `/franchise/${options.fdNumber}`) {
      return html(200, page("Franchise", `<nav><a href="/logout">Log out</a></nav><h1>Franchise ${options.fdNumber}</h1>
        <a href="/franchise/${options.fdNumber}/earnings">Daily earnings</a> <a href="/franchise/${options.fdNumber}/earnings">Delete statement</a>
        ${options.periods ? `<a href="/franchise/${options.fdNumber}/payments">Payments</a>` : ""}
        <form method="post" action="/approve"><button type="submit">Approve</button></form>`));
    }
    if (url.pathname === `/franchise/${options.fdNumber}/earnings`) {
      const date = url.searchParams.get("date") ?? "2026-11-14";
      const hasReport = !(options.missingDates ?? []).includes(date);
      return html(200, page("Earnings", `<nav><a href="/logout">Log out</a></nav><h1>Daily earnings ${options.fdNumber}</h1><p>Date: ${date}</p>
        ${hasReport ? `<a href="/download/${date}.pdf">${options.downloadLabel ?? "Download PDF"}</a>` : "<p>No report for this date.</p>"}`));
    }
    if (options.periods && url.pathname === `/franchise/${options.fdNumber}/payments`) {
      const opts = (list: string[]) => list.map((o) => `<option>${o}</option>`).join("");
      return html(200, page("Payments", `<nav><a href="/logout">Log out</a></nav><h1>Payments ${options.fdNumber}</h1>
        <label for="y">Year</label><select id="y">${opts(options.periods.years)}</select>
        <label for="pp">Period</label><select id="pp">${opts(options.periods.options)}</select>
        <table><tr><th>Date</th><th>Driver</th><th>Total</th></tr></table>`));
    }
    if (url.pathname.startsWith("/download/")) {
      const date = url.pathname.slice("/download/".length, -4);
      const pdf = await earningsPdf({ fdNumber: options.fdNumber, date, corruptTotalBy: options.corruptPdf ? 25 : 0 });
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="earnings-${date}.pdf"` });
      return res.end(pdf);
    }
    if (url.pathname === "/approve") {
      writes += 1;
      return html(200, page("Approved", "<p>Approved</p>"));
    }
    return html(404, page("Not found", "<p>Not found</p>"));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    hits,
    writeHits: () => writes,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
