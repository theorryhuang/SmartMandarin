import { VocabClient } from "./VocabClient";
import { BackButton } from "@/app/_components/BackButton";

export default function VocabPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] sticky top-0 z-10">
          <BackButton href="/" />
          <div className="flex-1">
            <h1 className="font-semibold text-sm text-[var(--color-text-primary)]">My Vocabulary</h1>
          </div>
        </div>
        <VocabClient />
      </div>
    </main>
  );
}
