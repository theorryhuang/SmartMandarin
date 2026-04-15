import { AuthClient } from "./AuthClient";

export const metadata = { title: "Sign in · SmartMandarin" };

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default async function AuthPage({ searchParams }: Props) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen bg-[var(--color-background)]">
      <AuthClient errorParam={error} />
    </main>
  );
}
