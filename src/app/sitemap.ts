import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Only the public pages. Everything else needs a login. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = env.appUrl();
  return ["/", "/privacy", "/terms", "/cookies"].map((path) => ({ url: `${base}${path === "/" ? "" : path}` }));
}
