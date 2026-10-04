"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { PhoneIcon, DispatchIcon, CarIcon } from "./icons";

export function HowItWorks() {
  const { t } = useLanguage();

  const steps = [
    { icon: PhoneIcon, title: t.howItWorks.step1Title, desc: t.howItWorks.step1Desc },
    { icon: DispatchIcon, title: t.howItWorks.step2Title, desc: t.howItWorks.step2Desc },
    { icon: CarIcon, title: t.howItWorks.step3Title, desc: t.howItWorks.step3Desc },
  ];

  return (
    <section id="how-it-works" className="bg-surface py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">{t.howItWorks.title}</h2>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-2xl bg-white p-6 text-center shadow-sm">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue/10 text-blue">
                <step.icon className="h-7 w-7" />
              </span>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-blue">
                Step {index + 1}
              </p>
              <h3 className="mt-1 text-lg font-semibold text-navy">{step.title}</h3>
              <p className="mt-2 text-sm text-navy/70">{step.desc}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-3xl rounded-2xl border border-navy/10 bg-white px-6 py-4 text-center text-sm font-medium text-navy/80">
          {t.howItWorks.disclaimer}
        </p>
      </div>
    </section>
  );
}
