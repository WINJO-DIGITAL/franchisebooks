import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/welcome", "/privacy", "/terms", "/cookies", "/auth", "/api/cron", "/api/dropbox/webhook", "/api/stripe/webhook", "/api/health", "/robots.txt", "/sitemap.xml"];

/** Pages and endpoints anyone may open without signing in. */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Refreshes the Supabase session cookie and sends signed-out visitors to the login page. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const isPublic = isPublicPath(path);

  // The front page: visitors who are not signed in see the sales page at "/"; signed-in users get their dashboard.
  if (!data.user && path === "/") {
    const welcome = request.nextUrl.clone();
    welcome.pathname = "/welcome";
    welcome.search = "";
    return NextResponse.rewrite(welcome);
  }
  if (!data.user && !isPublic) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    if (path !== "/") login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }
  // Two-step sign-in: a session that has only used the password cannot open anything until the code has been entered.
  if (data.user && !isPublic) {
    const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (level && level.nextLevel === "aal2" && level.currentLevel !== "aal2") {
      if (path.startsWith("/api/")) return NextResponse.json({ error: "Two-step sign-in is needed" }, { status: 401 });
      const verify = request.nextUrl.clone();
      verify.pathname = "/login/verify";
      verify.search = "";
      if (path !== "/") verify.searchParams.set("next", path);
      return NextResponse.redirect(verify);
    }
  }
  if (data.user && (path === "/login" || path === "/signup")) {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}
