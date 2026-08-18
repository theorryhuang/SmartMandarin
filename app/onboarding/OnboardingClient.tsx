"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyRound, Puzzle, AudioLines, CheckCircle2, ArrowRight, Rocket, type LucideIcon } from "lucide-react";
import { useLanguage } from "@/app/_components/LanguageContext";
import { markOnboardingComplete, type OnboardingStatus } from "@/app/actions/onboarding";

export function OnboardingClient({ initialStatus }: { initialStatus: OnboardingStatus }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();

  function finish() {
    // "Continue to app" doubles as "skip for now" — nothing here blocks it,
    // whether the user did every step or none of them.
    startFinishing(async () => {
      await markOnboardingComplete();
      router.push("/");
    });
  }

  return (
    <>
      <div className="flex flex-col items-center text-center gap-2 pb-2">
        <div className="w-14 h-14 rounded-2xl bg-violet-700 flex items-center justify-center text-white">
          <Rocket size={26} />
        </div>
        <h1 className="text-2xl font-semibold">{t.onboardingTitle}</h1>
        <p className="text-sm text-[var(--color-text-muted)]">{t.onboardingSubtitle}</p>
      </div>

      <OnboardingStep
        icon={KeyRound}
        title={t.profileNavGeminiKey}
        desc={t.onboardingGeminiDesc}
        done={initialStatus.hasGeminiKey}
        doneLabel={t.onboardingDone}
        href="/settings/gemini-key?from=onboarding"
        cta={t.onboardingGeminiCta}
        badgeLabel={t.onboardingRequired}
        required
      />

      <OnboardingStep
        icon={Puzzle}
        title={t.profileNavExtension}
        desc={t.onboardingExtensionDesc}
        done={initialStatus.hasExtensionToken}
        doneLabel={t.onboardingDone}
        href="/settings/extension?from=onboarding"
        cta={t.onboardingExtensionCta}
        badgeLabel={t.onboardingOptional}
      />

      <OnboardingStep
        icon={AudioLines}
        title={t.profileNavElevenLabsKey}
        desc={t.onboardingElevenLabsDesc}
        done={initialStatus.hasElevenLabsKey}
        doneLabel={t.onboardingDone}
        href="/settings/elevenlabs-key?from=onboarding"
        cta={t.onboardingElevenLabsCta}
        badgeLabel={t.onboardingRequired}
        required
      />

      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          onClick={finish}
          disabled={finishing}
          className="w-full py-3 rounded-2xl bg-violet-700 hover:bg-violet-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {t.onboardingContinue}
          <ArrowRight size={15} />
        </button>
        <p className="text-xs text-[var(--color-text-muted)] text-center">{t.onboardingSkipHint}</p>
        <Link
          href="/instructions"
          className="text-xs text-violet-600 hover:text-violet-700 transition-colors mt-1"
        >
          {t.onboardingLearnMore}
        </Link>
      </div>
    </>
  );
}

function OnboardingStep({
  icon: Icon,
  title,
  desc,
  done,
  doneLabel,
  href,
  cta,
  badgeLabel,
  required,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  done: boolean;
  doneLabel: string;
  href: string;
  cta: string;
  badgeLabel: string;
  required?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
            done ? "bg-emerald-100 text-emerald-600" : "bg-violet-100 text-violet-600"
          }`}
        >
          {done ? <CheckCircle2 size={18} /> : <Icon size={18} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                required ? "bg-violet-100 text-violet-700" : "bg-[var(--color-background)] text-[var(--color-text-muted)]"
              }`}
            >
              {badgeLabel}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>
        </div>
      </div>
      {done ? (
        <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
          <CheckCircle2 size={12} />
          {doneLabel}
        </span>
      ) : (
        <Link href={href} className="text-xs font-medium text-violet-600 hover:text-violet-700 flex items-center gap-1 self-start">
          {cta}
          <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}
