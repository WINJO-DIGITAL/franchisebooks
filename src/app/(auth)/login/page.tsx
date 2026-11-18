import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const params = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Use the email address and password for your account.</p>
      <LoginForm next={params.next ?? "/"} />
      <p className="mt-6 text-center text-sm text-muted">
        New here? <Link href="/signup" className="text-accent underline-offset-2 hover:underline">Create an account</Link>
      </p>
    </>
  );
}
