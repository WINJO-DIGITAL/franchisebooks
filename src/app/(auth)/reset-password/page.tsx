import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a New Password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a New Password</h1>
      <p className="mt-1 text-sm text-muted">Use at least 10 characters.</p>
      <ResetForm />
    </>
  );
}
