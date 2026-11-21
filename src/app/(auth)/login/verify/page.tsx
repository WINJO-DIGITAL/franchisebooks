import type { Metadata } from "next";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Enter Your Code" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Enter Your Code</h1>
      <p className="mt-1.5 text-sm text-muted">Open your authenticator app and enter the 6-digit code it shows for Franchise Books.</p>
      <VerifyForm next={params.next ?? "/"} />
    </>
  );
}
