import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="mk-ruled pointer-events-none absolute inset-x-0 top-0 h-[26rem]" />
      <div className="relative w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <Link href="/welcome" className="rounded-lg">
            <Image src="/logo.png" alt="Franchise Books by WINJO Digital" width={629} height={390} className="h-28 w-auto" />
          </Link>
        </div>
        <div className="rounded-lg border border-line-strong bg-surface p-6 shadow-[0_1px_0_rgb(63_28_8/0.04),0_28px_56px_-28px_rgb(63_28_8/0.32)] sm:p-8">{children}</div>
      </div>
    </main>
  );
}
