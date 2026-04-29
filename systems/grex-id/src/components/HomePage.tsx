"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import LocaleSelector from "@/src/components/shared/LocaleSelector";
import Spinner from "@/src/components/shared/Spinner";
import Modal from "@/src/components/shared/Modal";
import BotProtection from "@/src/components/shared/BotProtection";
import SearchableSelectField from "@/src/components/fields/SearchableSelectField";
import type { SubformRef } from "@/src/contracts/high_level/components";
import LeadCoreSubform from "@/src/components/subforms/LeadCoreSubform";
import FacialBiometricsSubform from "./FacialBiometricsSubform.tsx";
import { useTenantContext } from "@/src/hooks/useTenantContext";

export default function GrexIdHomePage() {
  const { t, publicSystem: systemInfo, loadPublicSystem } = useTenantContext();
  useEffect(() => {
    loadPublicSystem("grex-id");
  }, [loadPublicSystem]);
  const systemName = systemInfo?.name ?? "Grex ID";
  const [showForm, setShowForm] = useState(false);
  const [botToken, setBotToken] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<
    { id: string; label: string }[]
  >([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    {
      success: boolean;
      message: string;
    } | null
  >(null);

  const leadCoreRef = useRef<SubformRef>(null);
  const facialRef = useRef<SubformRef>(null);

  const fetchCompanies = useCallback(async (search: string) => {
    const res = await fetch(
      `/api/companies?search=${encodeURIComponent(search)}&systemSlug=grex-id`,
    );
    const json = await res.json();
    return (json.data ?? []).map((c: { id: string; name: string }) => ({
      id: c.id,
      label: c.name,
    }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    if (!botToken) return;
    if (selectedCompany.length === 0) {
      setResult({
        success: false,
        message: t("systems.grex-id.home.selectCompanyError"),
      });
      return;
    }

    const leadData = leadCoreRef.current?.getData() ?? {};
    const facialData = facialRef.current?.getData() ?? {};

    if (!leadCoreRef.current?.isValid()) {
      setResult({
        success: false,
        message: t("systems.grex-id.home.formError"),
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/systems/grex-id/leads/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...leadData,
          ...facialData,
          botToken,
          termsAccepted,
          tenantIds: selectedCompany.map((company) => company.id),
          systemSlug: "grex-id",
        }),
      });
      const json = await res.json();

      if (json.success) {
        if (json.data?.requiresVerification) {
          setResult({
            success: true,
            message: t("systems.grex-id.home.verificationSent"),
          });
        } else {
          setResult({
            success: true,
            message: t("systems.grex-id.home.registerSuccess"),
          });
        }
      } else {
        setResult({
          success: false,
          message: json.error?.message ??
            t("systems.grex-id.home.registerError"),
        });
      }
    } catch {
      setResult({
        success: false,
        message: t("systems.grex-id.home.registerError"),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const problems = [
    t("systems.grex-id.home.problem1"),
    t("systems.grex-id.home.problem2"),
    t("systems.grex-id.home.problem3"),
    t("systems.grex-id.home.problem4"),
    t("systems.grex-id.home.problem5"),
  ];

  const solutions = [
    { emoji: "📸", text: t("systems.grex-id.home.sol1") },
    { emoji: "📊", text: t("systems.grex-id.home.sol2") },
    { emoji: "👥", text: t("systems.grex-id.home.sol3") },
    { emoji: "🔒", text: t("systems.grex-id.home.sol4") },
    { emoji: "🔔", text: t("systems.grex-id.home.sol5") },
    { emoji: "💬", text: t("systems.grex-id.home.sol6") },
    { emoji: "📈", text: t("systems.grex-id.home.sol7") },
    { emoji: "📧", text: t("systems.grex-id.home.sol8") },
  ];

  const benefits = [
    {
      emoji: "🤝",
      title: t("systems.grex-id.home.benefit1"),
      desc: t("systems.grex-id.home.benefit1Desc"),
    },
    {
      emoji: "📋",
      title: t("systems.grex-id.home.benefit2"),
      desc: t("systems.grex-id.home.benefit2Desc"),
    },
    {
      emoji: "🙌",
      title: t("systems.grex-id.home.benefit3"),
      desc: t("systems.grex-id.home.benefit3Desc"),
    },
    {
      emoji: "📡",
      title: t("systems.grex-id.home.benefit4"),
      desc: t("systems.grex-id.home.benefit4Desc"),
    },
  ];

  const differentials = [
    { emoji: "⚡", text: t("systems.grex-id.home.diff1") },
    { emoji: "💰", text: t("systems.grex-id.home.diff2") },
    { emoji: "🛟", text: t("systems.grex-id.home.diff3") },
    { emoji: "🎓", text: t("systems.grex-id.home.diff4") },
    { emoji: "🛡", text: t("systems.grex-id.home.diff5") },
    { emoji: "📊", text: t("systems.grex-id.home.diff6") },
    { emoji: "🖱", text: t("systems.grex-id.home.diff7") },
    { emoji: "🎨", text: t("systems.grex-id.home.diff8") },
  ];

  return (
    <div className="min-h-screen bg-[var(--color-black)] text-white overflow-hidden">
      {/* ─── LOCALE SELECTOR ─── */}
      <div className="fixed top-4 right-4 z-50">
        <LocaleSelector />
      </div>

      {
        /* ═══════════════════════════════════════════════════════════
          HERO SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative min-h-screen flex flex-col items-center justify-center px-4 py-20">
        {/* Layered background orbs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-[var(--color-primary-green)] opacity-[0.04] blur-[150px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-[var(--color-secondary-blue)] opacity-[0.05] blur-[150px]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full bg-[var(--color-light-green)] opacity-[0.02] blur-[120px]" />
        </div>

        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative z-10 max-w-5xl mx-auto text-center">
          {/* Title */}
          <h1 className="text-6xl sm:text-7xl lg:text-8xl font-black tracking-tighter">
            <span className="bg-gradient-to-r from-[var(--color-primary-green)] via-[var(--color-light-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
              {systemName}
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mt-6 max-w-3xl mx-auto text-lg sm:text-xl text-[var(--color-light-text)] leading-relaxed">
            {t("systems.grex-id.home.subtitle")}
          </p>

          {/* Scripture quote */}
          <div className="mt-10 max-w-2xl mx-auto">
            <div className="relative px-8 py-6">
              <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-[var(--color-primary-green)] to-[var(--color-secondary-blue)]" />
              <p className="text-sm sm:text-base italic text-white/60 leading-relaxed">
                {t("systems.grex-id.home.heroVerse")}
              </p>
              <p className="mt-3 text-xs font-semibold text-[var(--color-primary-green)] tracking-wider uppercase">
                {t("systems.grex-id.home.heroVerseRef")}
              </p>
            </div>
          </div>

          {/* CTA Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-4 mt-12">
            <Link
              href="/login?systemSlug=grex-id"
              className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-hover-green)] px-8 py-4 text-lg font-bold text-black transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(2,208,125,0.4)]"
            >
              <span>🚀</span>
              {t("systems.grex-id.home.loginCta")}
            </Link>
            <button
              onClick={() => setShowForm(true)}
              className="group relative inline-flex items-center gap-2 rounded-xl border-2 border-[var(--color-primary-green)]/50 px-8 py-4 text-lg font-bold text-[var(--color-primary-green)] transition-all duration-300 hover:border-[var(--color-primary-green)] hover:bg-[var(--color-primary-green)]/5 hover:-translate-y-1"
            >
              <span>📋</span>
              {t("systems.grex-id.home.registerCta")}
            </button>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/30 animate-bounce">
          <span className="text-lg">↓</span>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          THESIS SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-primary-green)]/[0.02] to-transparent pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold mb-16">
            <span className="relative inline-block">
              <span className="relative z-10 text-white">
                {t("systems.grex-id.home.thesisTitle")}
              </span>
              <span className="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] opacity-30 rounded-full -z-0" />
            </span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary-green)]/10 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300 h-full flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/10 flex items-center justify-center mb-6">
                  <span className="text-4xl">🖥</span>
                </div>
                <p className="text-xl font-semibold text-white leading-relaxed">
                  {t("systems.grex-id.home.thesisLeft")}
                </p>
              </div>
            </div>

            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-secondary-blue)]/10 to-transparent rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="relative backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-secondary-blue)]/10 transition-all duration-300 h-full flex flex-col items-center text-center">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-secondary-blue)]/20 to-[var(--color-primary-green)]/10 flex items-center justify-center mb-6">
                  <span className="text-4xl">🌟</span>
                </div>
                <p className="text-xl font-semibold text-white leading-relaxed">
                  {t("systems.grex-id.home.thesisRight")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          PROBLEM SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <div className="flex items-start gap-6 mb-12">
            <div className="hidden sm:block w-1 self-stretch rounded-full bg-gradient-to-b from-red-500/60 to-red-500/10 shrink-0" />
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                {t("systems.grex-id.home.problemTitle")}
              </h2>
              <p className="text-lg sm:text-xl text-red-300/80 italic leading-relaxed max-w-3xl mt-6">
                &ldquo;{t("systems.grex-id.home.problemQuote")}&rdquo;
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-10">
            {problems.map((problem, i) => (
              <div
                key={i}
                className="flex items-start gap-3 backdrop-blur-md bg-red-500/[0.04] border border-dashed border-red-500/20 rounded-xl p-5 hover:bg-red-500/[0.07] transition-colors duration-300"
              >
                <span className="text-red-400/80 text-lg mt-0.5 shrink-0">
                  ✕
                </span>
                <p className="text-white/80 text-sm leading-relaxed">
                  {problem}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          HOW IT WORKS - FLOW DIAGRAM
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-secondary-blue)]/[0.02] to-transparent pointer-events-none" />
        <div className="relative max-w-6xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-white mb-4">
            {t("systems.grex-id.home.howTitle")}
          </h2>
          <div className="mx-auto w-24 h-1 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] mb-16" />

          {/* Pipeline steps */}
          <div className="flex flex-col lg:flex-row items-center justify-center gap-4 lg:gap-0 mb-16">
            {[
              {
                emoji: "📹",
                title: t("systems.grex-id.home.howStep1"),
                desc: t("systems.grex-id.home.howStep1Desc"),
              },
              {
                emoji: "🧠",
                title: t("systems.grex-id.home.howStep2"),
                desc: t("systems.grex-id.home.howStep2Desc"),
              },
              {
                emoji: "🗄",
                title: t("systems.grex-id.home.howStep3"),
                desc: t("systems.grex-id.home.howStep3Desc"),
              },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-4 lg:gap-0">
                <div className="backdrop-blur-md bg-white/[0.04] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-6 w-56 text-center hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
                  <div className="w-14 h-14 mx-auto rounded-xl bg-gradient-to-br from-[var(--color-primary-green)]/20 to-[var(--color-secondary-blue)]/10 flex items-center justify-center mb-3">
                    <span className="text-2xl">{step.emoji}</span>
                  </div>
                  <h4 className="text-white font-semibold text-sm mb-1">
                    {step.title}
                  </h4>
                  <p className="text-[var(--color-light-text)] text-xs">
                    {step.desc}
                  </p>
                </div>
                {i < 2 && (
                  <div className="hidden lg:flex items-center px-3">
                    <div className="w-12 h-px bg-gradient-to-r from-[var(--color-primary-green)]/40 to-[var(--color-secondary-blue)]/40" />
                    <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-[var(--color-secondary-blue)]/40" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Branch: Member vs Visitor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
            <div className="relative group">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[var(--color-primary-green)] flex items-center justify-center">
                <span className="text-black text-xs font-bold">✓</span>
              </div>
              <div className="backdrop-blur-md bg-[var(--color-primary-green)]/[0.06] border border-dashed border-[var(--color-primary-green)]/30 rounded-2xl p-6 text-center hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-primary-green)]/15 transition-all duration-300">
                <span className="text-3xl mb-3 block">🏠</span>
                <h4 className="text-[var(--color-primary-green)] font-bold text-lg mb-2">
                  {t("systems.grex-id.home.howMember")}
                </h4>
                <p className="text-white/70 text-sm">
                  {t("systems.grex-id.home.howMemberDesc")}
                </p>
              </div>
            </div>

            <div className="relative group">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[var(--color-secondary-blue)] flex items-center justify-center">
                <span className="text-black text-xs font-bold">?</span>
              </div>
              <div className="backdrop-blur-md bg-[var(--color-secondary-blue)]/[0.06] border border-dashed border-[var(--color-secondary-blue)]/30 rounded-2xl p-6 text-center hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-secondary-blue)]/15 transition-all duration-300">
                <span className="text-3xl mb-3 block">👋</span>
                <h4 className="text-[var(--color-secondary-blue)] font-bold text-lg mb-2">
                  {t("systems.grex-id.home.howVisitor")}
                </h4>
                <p className="text-white/70 text-sm">
                  {t("systems.grex-id.home.howVisitorDesc")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          SOLUTION SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-primary-green)]/20 to-transparent" />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-white mb-2">
            {t("systems.grex-id.home.solutionTitle")}
          </h2>
          <p className="text-center text-[var(--color-primary-green)]/70 text-sm font-medium mb-12">
            {t("systems.grex-id.home.solutionSubtitle")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {solutions.map((sol, i) => (
              <div
                key={i}
                className="group backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 hover:bg-white/[0.06] transition-all duration-300"
              >
                <span className="text-2xl mb-3 block group-hover:scale-110 transition-transform duration-300">
                  {sol.emoji}
                </span>
                <p className="text-white/90 text-sm font-medium">{sol.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          BENEFITS SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--color-primary-green)]/[0.015] to-transparent pointer-events-none" />
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-white mb-4">
            {t("systems.grex-id.home.benefitsTitle")}
          </h2>
          <div className="mx-auto w-24 h-1 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] mb-16" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {benefits.map((benefit, i) => (
              <div
                key={i}
                className="group relative backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300"
              >
                <div className="flex items-start gap-5">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[var(--color-primary-green)]/15 to-[var(--color-secondary-blue)]/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300">
                    <span className="text-2xl">{benefit.emoji}</span>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg mb-2">
                      {benefit.title}
                    </h3>
                    <p className="text-[var(--color-light-text)] text-sm leading-relaxed">
                      {benefit.desc}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          STATS SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-white mb-2">
            {t("systems.grex-id.home.statsTitle")}
          </h2>
          <p className="text-center text-[var(--color-light-text)] text-sm mb-16">
            {t("systems.grex-id.home.statsChurches")}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-2xl mx-auto">
            <div className="text-center backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-10 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 transition-all duration-300">
              <span className="text-5xl sm:text-6xl font-black bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-light-green)] bg-clip-text text-transparent">
                {t("systems.grex-id.home.statsBrazil")}
              </span>
              <p className="mt-3 text-[var(--color-light-text)] text-sm font-medium uppercase tracking-wider">
                {t("systems.grex-id.home.statsBrazilLabel")}
              </p>
            </div>

            <div className="text-center backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-10 hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-secondary-blue)]/10 transition-all duration-300">
              <span className="text-5xl sm:text-6xl font-black bg-gradient-to-r from-[var(--color-secondary-blue)] to-[var(--color-light-green)] bg-clip-text text-transparent">
                {t("systems.grex-id.home.statsAmericas")}
              </span>
              <p className="mt-3 text-[var(--color-light-text)] text-sm font-medium uppercase tracking-wider">
                {t("systems.grex-id.home.statsAmericasLabel")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          DIFFERENTIALS SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-secondary-blue)]/20 to-transparent" />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <h2 className="text-center text-3xl sm:text-4xl font-bold text-white mb-4">
            {t("systems.grex-id.home.diffTitle")}
          </h2>
          <div className="mx-auto w-24 h-1 rounded-full bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] mb-16" />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {differentials.map((diff, i) => (
              <div
                key={i}
                className="group backdrop-blur-md bg-white/[0.03] border border-dashed border-[var(--color-dark-gray)] rounded-xl p-5 text-center hover:-translate-y-1 hover:shadow-lg hover:shadow-[var(--color-light-green)]/10 hover:border-[var(--color-primary-green)]/30 transition-all duration-300"
              >
                <span className="text-2xl mb-2 block group-hover:scale-125 transition-transform duration-300">
                  {diff.emoji}
                </span>
                <p className="text-white/90 text-xs sm:text-sm font-semibold">
                  {diff.text}
                </p>
              </div>
            ))}
          </div>

          {/* Cloud badge */}
          <div className="mt-12 max-w-2xl mx-auto backdrop-blur-md bg-gradient-to-r from-[var(--color-primary-green)]/[0.06] to-[var(--color-secondary-blue)]/[0.06] border border-dashed border-[var(--color-primary-green)]/20 rounded-2xl p-8 text-center">
            <span className="text-4xl mb-3 block">☁</span>
            <h3 className="text-xl font-bold text-white mb-2">
              {t("systems.grex-id.home.cloudTitle")}
            </h3>
            <p className="text-[var(--color-light-text)] text-sm leading-relaxed">
              {t("systems.grex-id.home.cloudDesc")}
            </p>
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          FEATURES HIGHLIGHTS
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="relative max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                emoji: "📸",
                titleKey: "systems.grex-id.home.feature1Title",
                descKey: "systems.grex-id.home.feature1Desc",
                gradient: "from-[var(--color-primary-green)]",
              },
              {
                emoji: "📊",
                titleKey: "systems.grex-id.home.feature2Title",
                descKey: "systems.grex-id.home.feature2Desc",
                gradient: "from-[var(--color-secondary-blue)]",
              },
              {
                emoji: "🔒",
                titleKey: "systems.grex-id.home.feature3Title",
                descKey: "systems.grex-id.home.feature3Desc",
                gradient: "from-[var(--color-light-green)]",
              },
            ].map((feat) => (
              <div key={feat.titleKey} className="group relative">
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${feat.gradient} to-transparent rounded-2xl blur-2xl opacity-0 group-hover:opacity-[0.08] transition-opacity duration-500`}
                />
                <div className="relative backdrop-blur-md bg-white/[0.04] border border-dashed border-[var(--color-dark-gray)] rounded-2xl p-8 hover:-translate-y-2 hover:shadow-xl hover:shadow-[var(--color-light-green)]/10 transition-all duration-300 h-full">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-white/10 to-white/[0.02] flex items-center justify-center mb-5 group-hover:scale-110 transition-transform duration-300">
                    <span className="text-3xl">{feat.emoji}</span>
                  </div>
                  <h3 className="text-white font-bold text-lg mb-3">
                    {t(feat.titleKey)}
                  </h3>
                  <p className="text-[var(--color-light-text)] text-sm leading-relaxed">
                    {t(feat.descKey)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {
        /* ═══════════════════════════════════════════════════════════
          CTA SECTION
      ═══════════════════════════════════════════════════════════ */
      }
      <section className="relative py-24 px-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-primary-green)]/20 to-transparent" />
        </div>

        <div className="relative max-w-lg mx-auto text-center">
          <span className="text-5xl mb-6 block">📋</span>
          <h2 className="text-3xl font-bold text-white mb-4">
            {t("systems.grex-id.home.registerCta")}
          </h2>
          <p className="text-[var(--color-light-text)] text-sm mb-8">
            {t("systems.grex-id.home.subtitle")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              onClick={() => setShowForm(true)}
              className="rounded-xl bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-hover-green)] px-8 py-4 text-lg font-bold text-black transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(2,208,125,0.4)]"
            >
              {t("systems.grex-id.home.registerCta")}
            </button>
            <Link
              href="/login?systemSlug=grex-id"
              className="rounded-xl border-2 border-[var(--color-primary-green)]/50 px-8 py-4 text-lg font-bold text-[var(--color-primary-green)] transition-all duration-300 hover:border-[var(--color-primary-green)] hover:bg-[var(--color-primary-green)]/5 hover:-translate-y-1"
            >
              {t("systems.grex-id.home.loginCta")}
            </Link>
          </div>
        </div>
      </section>

      {/* ─── LEAD REGISTRATION MODAL ─── */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t("systems.grex-id.home.formTitle")}
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <LeadCoreSubform
            ref={leadCoreRef}
            hideTags
            companyId={selectedCompany[0]?.id}
            systemSlug="grex-id"
          />

          <div>
            <h3 className="text-sm font-semibold text-[var(--color-secondary-blue)] mb-3 flex items-center gap-2">
              <span>🏢</span> {t("systems.grex-id.home.selectCompanies")}
            </h3>
            <SearchableSelectField
              fetchFn={fetchCompanies}
              multiple={false}
              onChange={setSelectedCompany}
            />
          </div>

          <FacialBiometricsSubform
            ref={facialRef}
            companyId={selectedCompany[0]?.id}
            systemSlug="grex-id"
          />

          <BotProtection onVerified={setBotToken} />

          {/* Terms of Service (LGPD) */}
          <div className="space-y-2">
            {systemInfo?.termsOfService
              ? (
                <div
                  className="max-h-32 overflow-y-auto rounded-xl border border-[var(--color-dark-gray)] bg-white/5 p-3 text-xs text-[var(--color-light-text)] whitespace-pre-wrap text-left"
                  dangerouslySetInnerHTML={{
                    __html: systemInfo.termsOfService,
                  }}
                />
              )
              : (
                <p className="text-xs text-[var(--color-light-text)]">
                  {t("common.terms.title")}
                </p>
              )}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[var(--color-dark-gray)] bg-white/5 accent-[var(--color-primary-green)]"
              />
              <span className="text-sm text-[var(--color-light-text)]">
                {t("common.terms.accept")}
              </span>
            </label>
            <a
              href="/terms?systemSlug=grex-id"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-[var(--color-primary-green)] hover:text-[var(--color-light-green)] transition-colors font-medium underline underline-offset-2"
            >
              {t("common.terms.viewFull")}
            </a>
          </div>

          {result && (
            <div
              className={`rounded-xl p-4 text-sm ${
                result.success
                  ? "bg-[var(--color-primary-green)]/10 text-[var(--color-primary-green)] border border-[var(--color-primary-green)]/30"
                  : "bg-red-500/10 text-red-400 border border-red-400/30"
              }`}
            >
              {result.success ? "✓" : "✕"} {t(result.message)}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !botToken || !termsAccepted}
            className="w-full rounded-xl bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-hover-green)] px-6 py-4 text-base font-bold text-black transition-all duration-300 hover:opacity-90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[var(--color-light-green)]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting
              ? (
                <Spinner
                  size="sm"
                  className="border-black border-t-transparent"
                />
              )
              : <span>🚀</span>}
            {t("systems.grex-id.home.submitBtn")}
          </button>
        </form>
      </Modal>

      {
        /* ═══════════════════════════════════════════════════════════
          FOOTER
      ═══════════════════════════════════════════════════════════ */
      }
      <footer className="relative py-12 px-4">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--color-dark-gray)] to-transparent" />
        <div className="max-w-5xl mx-auto text-center">
          <h3 className="text-2xl font-black mb-2">
            <span className="bg-gradient-to-r from-[var(--color-primary-green)] to-[var(--color-secondary-blue)] bg-clip-text text-transparent">
              {systemName}
            </span>
          </h3>
          <p className="text-[var(--color-light-text)] text-sm mb-1">
            {t("systems.grex-id.home.footer")}
          </p>
          <p className="text-white/30 text-xs">
            {t("systems.grex-id.home.footerTagline")}
          </p>
        </div>
      </footer>
    </div>
  );
}
