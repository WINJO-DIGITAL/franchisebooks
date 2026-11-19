import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Public: crawlers may read the sales and legal pages. Signed-in pages need a login and are marked noindex anyway. */
export default function robots(): MetadataRoute.Robots {
  const base = env.appUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
