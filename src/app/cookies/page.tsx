import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Cookies" };

export default function CookiesPage() {
  return (
    <LegalPage title="Cookies" updated="18 November 2026">
      <p>We use only the cookies the app needs to work. We do not use advertising or tracking cookies.</p>
      <ul>
        <li><strong>Sign-in cookies:</strong> keep you signed in. Essential, so they cannot be switched off.</li>
        <li><strong>Franchise selection:</strong> remembers which franchise you chose. Essential for the switcher.</li>
      </ul>
    </LegalPage>
  );
}
