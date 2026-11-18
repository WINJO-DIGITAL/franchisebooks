import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">Start with your email address. Next you choose your plan, then connect DPD.</p>
      <ol className="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-medium" aria-label="Three steps">
        <li className="rounded-lg bg-accent-soft px-2 py-2 text-accent">1. Account</li>
        <li className="rounded-lg bg-sunken px-2 py-2 text-muted">2. Plan</li>
        <li className="rounded-lg bg-sunken px-2 py-2 text-muted">3. Connect</li>
      </ol>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="text-accent underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
