"use client";

import { useRouter } from "next/navigation";
import { User } from "lucide-react";

/** Paired with HomeButton across headers — always routes to "/profile", so
 *  account settings stay one tap away from every screen, not just Home's avatar. */
export function ProfileButton({ className = "", badge = null }: { className?: string; badge?: number | null }) {
  const router = useRouter();

  return (
    <button
      onClick={() => router.push("/profile")}
      aria-label="Profile"
      className={`relative w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-background)] transition-colors ${className}`}
    >
      <User size={18} />
      {!!badge && (
        <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] bg-orange-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
          {badge}
        </span>
      )}
    </button>
  );
}
