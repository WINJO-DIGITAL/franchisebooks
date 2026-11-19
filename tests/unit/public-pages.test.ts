import { afterEach, describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isPublicPath } from "@/lib/supabase/proxy";

const saved = process.env.APP_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = saved;
});

describe("robots.txt and sitemap.xml", () => {
  it("can be opened without signing in, while private pages still need a login", () => {
    expect(isPublicPath("/robots.txt")).toBe(true);
    expect(isPublicPath("/sitemap.xml")).toBe(true);
    expect(isPublicPath("/welcome")).toBe(true);
    for (const path of ["/", "/drivers", "/earnings", "/settings", "/check"]) expect(isPublicPath(path), path).toBe(false);
  });

  it("point crawlers at the public pages only, on the app's own address", () => {
    process.env.APP_URL = "https://franchisebooks.example.co.uk/";
    const r = robots();
    expect(r.sitemap).toBe("https://franchisebooks.example.co.uk/sitemap.xml");
    expect(r.rules).toEqual([{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }]);
    expect(sitemap().map((e) => e.url)).toEqual([
      "https://franchisebooks.example.co.uk",
      "https://franchisebooks.example.co.uk/privacy",
      "https://franchisebooks.example.co.uk/terms",
      "https://franchisebooks.example.co.uk/cookies",
    ]);
  });
});
