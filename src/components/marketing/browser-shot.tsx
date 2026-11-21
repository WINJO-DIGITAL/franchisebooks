import Image from "next/image";

/** A capture of the app on a computer, in a plain browser frame. Demo account, synthetic figures. */
export function BrowserShot({ src, alt }: { src: string; alt: string }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_1px_0_rgb(63_28_8/0.04),0_28px_56px_-28px_rgb(63_28_8/0.4)]">
      <div aria-hidden className="flex items-center gap-1.5 border-b border-line bg-sunken/70 px-3 py-2">
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
      </div>
      <Image src={src} alt={alt} width={1600} height={1000} sizes="(min-width: 896px) 56rem, 100vw" className="block h-auto w-full" />
    </figure>
  );
}
