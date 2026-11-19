import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="18 November 2026">
      <h2>Who Provides This Service</h2>
      <p>Franchise Books is a product of WINJO DIGITAL, a sole trader trading as WINJO DIGITAL (Nitisat Sirisom), of 3 Knoxwood Close, Thornton-Cleveleys, FY5 3UP. Contact: hello@winjodigital.co.uk. These terms are WINJO DIGITAL&apos;s terms for all its products, and WINJO DIGITAL is the business you contract with.</p>
      <h2>The Service</h2>
      <p>Franchise Books reads figures from your DPD partner portal and presents them as income, expenses and driver pay. It is an aid to your own records and is not an accountancy service or tax advice.</p>
      <h2>Your Responsibilities</h2>
      <ul>
        <li>You must be entitled to use the DPD logins you give us, and keep them secret.</li>
        <li>You are responsible for checking the figures before paying drivers or filing returns.</li>
      </ul>
      <h2>What We Do With DPD</h2>
      <p>The connection to DPD only reads and downloads. It does not change anything in DPD. It does not get past verification codes or CAPTCHAs.</p>
      <h2>Price and Payment</h2>
      <p>The subscription is £49 a month per account, charged monthly through Stripe. No VAT is charged: the business is not VAT registered. You can cancel at any time under Manage billing; access continues to the end of the period paid for.</p>
      <h2>Availability</h2>
      <p>We work hard to keep the nightly reads running, but DPD can change its portal at any time, which can stop a read until we update it. We will tell you when this happens.</p>
      <h2>Liability</h2>
      <p>To the extent the law allows, our liability is limited to the subscription fees you paid in the previous 12 months. Nothing in these terms limits liability that cannot legally be limited.</p>
      <h2>Ending the Service</h2>
      <p>You can close your account at any time under Settings. We may end the service with reasonable notice.</p>
    </LegalPage>
  );
}
