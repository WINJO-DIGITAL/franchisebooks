import type { Metadata } from "next";
import { NotFoundView } from "@/components/errors/error-view";

export const metadata: Metadata = { title: "Page Not Found" };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <NotFoundView />
    </main>
  );
}
