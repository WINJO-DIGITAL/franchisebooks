import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Notice" updated="18 November 2026">
      <h2>Who We Are</h2>
      <p>Franchise Books is a product of WINJO DIGITAL, a sole trader trading as WINJO DIGITAL (Nitisat Sirisom), of 3 Knoxwood Close, Thornton-Cleveleys, FY5 3UP. WINJO DIGITAL decides how your information is used, so it is the controller under UK data protection law. Contact: hello@winjodigital.co.uk.</p>
      <h2>What We Collect</h2>
      <ul>
        <li>Your account details: name, email address and business name.</li>
        <li>Your DPD portal username and password, stored encrypted. Only the app can read them, to sign in and read your figures.</li>
        <li>The figures we read from DPD: payments, charges, invoices and driver details (names and DPD driver numbers).</li>
        <li>Billing details, handled by Stripe. We keep only the subscription status and the period end date.</li>
      </ul>
      <h2>Why We Use It</h2>
      <p>To provide the service you have subscribed to: reading your DPD figures every night, working out driver pay, and sending reports and service emails. Billing details are used to run your subscription.</p>
      <h2>Who We Share It With</h2>
      <ul>
        <li>Supabase, which hosts the database.</li>
        <li>Vercel, which hosts the web app. Stripe, which takes payments. Resend, which sends service emails.</li>
      </ul>
      <p>We do not sell your information.</p>
      <h2>How Long We Keep It</h2>
      <p>While your account is open. When you close it, your DPD logins and their passwords are deleted straight away. Financial records are kept for the period the law requires, and the rest is removed within 30 days.</p>
      <h2>Your Rights</h2>
      <p>You can ask for a copy of your data, ask us to correct it, or ask us to delete it, subject to the record-keeping above. You can also complain to the Information Commissioner&rsquo;s Office (ico.org.uk).</p>
    </LegalPage>
  );
}
