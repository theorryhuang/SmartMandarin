"use client";

import { useTransition } from "react";
import { resetMyData } from "@/app/actions/dev";

export function DevResetButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => resetMyData())}
      disabled={pending}
      className="text-xs text-red-500/60 hover:text-red-400 transition-colors disabled:opacity-40"
    >
      {pending ? "Resetting…" : "⚠ Reset my data (dev)"}
    </button>
  );
}
