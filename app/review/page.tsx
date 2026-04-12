import { getDueWords } from "@/app/actions/vocabulary";
import { ReviewSession } from "./ReviewSession";

export default async function ReviewPage() {
  const due = await getDueWords(20);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <ReviewSession initialCards={due} />
    </main>
  );
}
