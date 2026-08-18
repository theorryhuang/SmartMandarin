"use client";

import Link from "next/link";
import {
  KeyRound,
  Puzzle,
  MonitorSmartphone,
  CheckCircle2,
  ArrowRight,
  Brain,
  Flame,
  Mic,
  MessageCircle,
  BookOpen,
  List,
  Gauge,
  type LucideIcon,
} from "lucide-react";
import { useLanguage } from "@/app/_components/LanguageContext";
import type { OnboardingStatus } from "@/app/actions/onboarding";

export function InstructionsClient({ status }: { status: OnboardingStatus }) {
  const { t } = useLanguage();

  return (
    <>
      {/* ── Setup ─────────────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
          {t.instructionsSetupTitle}
        </h2>

        <SetupRow
          icon={KeyRound}
          title={t.instructionsSetupGeminiTitle}
          desc={t.instructionsSetupGeminiDesc}
          done={status.hasGeminiKey}
          doneLabel={t.onboardingDone}
          href="/settings/gemini-key"
          cta={t.onboardingGeminiCta}
        />

        <SetupRow
          icon={Puzzle}
          title={t.instructionsSetupExtensionTitle}
          desc={t.instructionsSetupExtensionDesc}
          done={status.hasExtensionToken}
          doneLabel={t.onboardingDone}
          href="/settings/extension"
          cta={t.onboardingExtensionCta}
        />

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-violet-100 text-violet-600">
              <MonitorSmartphone size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--color-text-primary)]">{t.instructionsSetupInstallTitle}</div>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{t.instructionsSetupInstallDesc}</p>
            </div>
          </div>
          <ul className="text-xs text-[var(--color-text-secondary)] flex flex-col gap-1 pl-12">
            <li>{t.instructionsInstallMac}</li>
            <li>{t.instructionsInstallIOS}</li>
            <li>{t.instructionsInstallChrome}</li>
          </ul>
        </div>
      </section>

      {/* ── What each tab does ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
          {t.instructionsTabsTitle}
        </h2>

        <TabRow icon={Brain} iconBg="bg-violet-100" iconColor="text-violet-600" title={t.instructionsTabReviewTitle} desc={t.instructionsTabReviewDesc} />
        <TabRow icon={Flame} iconBg="bg-orange-100" iconColor="text-orange-500" title={t.instructionsTabSlangTitle} desc={t.instructionsTabSlangDesc} />
        <TabRow icon={Mic} iconBg="bg-rose-100" iconColor="text-rose-600" title={t.instructionsTabSpeakingTitle} desc={t.instructionsTabSpeakingDesc} />
        <TabRow icon={MessageCircle} iconBg="bg-sky-100" iconColor="text-sky-600" title={t.instructionsTabConversationTitle} desc={t.instructionsTabConversationDesc} />
        <TabRow icon={BookOpen} iconBg="bg-emerald-100" iconColor="text-emerald-600" title={t.instructionsTabReaderTitle} desc={t.instructionsTabReaderDesc} />
        <TabRow icon={List} iconBg="bg-teal-100" iconColor="text-teal-600" title={t.instructionsTabVocabTitle} desc={t.instructionsTabVocabDesc} />
        <TabRow icon={Gauge} iconBg="bg-amber-100" iconColor="text-amber-600" title={t.instructionsTabAssessmentTitle} desc={t.instructionsTabAssessmentDesc} />
      </section>
    </>
  );
}

function SetupRow({
  icon: Icon,
  title,
  desc,
  done,
  doneLabel,
  href,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  done: boolean;
  doneLabel: string;
  href: string;
  cta: string;
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
          <div className="text-sm font-medium text-[var(--color-text-primary)]">{title}</div>
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

function TabRow({ icon: Icon, iconBg, iconColor, title, desc }: { icon: LucideIcon; iconBg: string; iconColor: string; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconColor}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-[var(--color-text-primary)]">{title}</div>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
