import Image from "next/image";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { MobileMenu } from "./mobile-menu";

export const SECTION_LINKS = [
  { href: "#how", label: "How It Works" },
  { href: "#inside", label: "Inside the Platform" },
  { href: "#trust", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: "#questions", label: "Questions" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line-strong/60 bg-paper/90 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 sm:gap-4 sm:px-6">
        <Link href="/welcome" aria-label="Franchise Books by Winjo Digital, home" className="shrink-0">
          <Image src="/logo.png" alt="" width={629} height={390} priority className="h-11 w-auto sm:h-14" />
        </Link>
        <nav aria-label="Sections" className="ml-6 hidden items-center gap-0.5 lg:flex">
          {SECTION_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
          <Link href="/login" className={buttonClass("quiet", "sm")}>Sign In</Link>
          <Link href="/signup" className={buttonClass("primary", "sm")}>Get Started</Link>
          <MobileMenu links={SECTION_LINKS} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const link = "underline-offset-2 transition-colors hover:text-ink hover:underline";
  return (
    <footer className="border-t border-line-strong bg-paper">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 text-sm text-muted sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Image src="/logo.png" alt="Franchise Books by Winjo Digital" width={629} height={390} className="h-14 w-auto" />
          <p className="mt-4 max-w-xs leading-relaxed">Franchise Books is an independent product by Winjo Digital. It is not affiliated with or endorsed by DPD.</p>
        </div>
        <nav aria-label="Product">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Product</p>
          <ul className="mt-3 space-y-2">
            {SECTION_LINKS.map((l) => <li key={l.href}><Link href={l.href} className={link}>{l.label}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Account">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Account</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/login" className={link}>Sign In</Link></li>
            <li><Link href="/signup" className={link}>Get Started</Link></li>
          </ul>
        </nav>
        <nav aria-label="Legal">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Legal</p>
          <ul className="mt-3 space-y-2">
            <li><Link href="/privacy" className={link}>Privacy</Link></li>
            <li><Link href="/terms" className={link}>Terms</Link></li>
            <li><Link href="/cookies" className={link}>Cookies</Link></li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
