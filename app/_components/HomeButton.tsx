"use client";

import { useRouter } from "next/navigation";
import { Home } from "lucide-react";

/** Paired with BackButton across headers — always routes to "/", so
 *  placement/behavior stays consistent regardless of a page's back target. */
export function HomeButton({ className = "" }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/")}
      aria-label="Home"
      className={`w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors ${className}`}
    >
      <Home size={18} />
    </button>
  );
}
