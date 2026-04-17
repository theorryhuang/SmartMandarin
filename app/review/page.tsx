import { ReviewFilterPicker } from "./ReviewFilterPicker";
import { BackButton } from "@/app/_components/BackButton";

export default function ReviewPage() {
  return (
    <main className="min-h-screen bg-[var(--color-background)] flex flex-col items-center justify-center p-6">
      <div className="absolute top-6 left-6">
        <BackButton href="/" />
      </div>
      <ReviewFilterPicker />
    </main>
  );
}
