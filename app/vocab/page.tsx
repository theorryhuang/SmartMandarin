import { Suspense } from "react";
import { VocabClient } from "./VocabClient";

export default function VocabPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg mx-auto">
        <Suspense>
          <VocabClient />
        </Suspense>
      </div>
    </main>
  );
}
