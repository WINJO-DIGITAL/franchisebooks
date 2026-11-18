import type { Metadata } from "next";
import Link from "next/link";
import { SignUpForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Start with your email address. Next you choose your plan, then connect DPD.</p>
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account? <Link href="/login" className="text-accent underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </>
  );
}
