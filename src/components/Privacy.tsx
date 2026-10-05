"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";

export function Privacy() {
  const { t } = useLanguage();

  const items = [
    { title: t.privacy.collectTitle, desc: t.privacy.collectDesc },
    { title: t.privacy.useTitle, desc: t.privacy.useDesc },
    { title: t.privacy.noSellTitle, desc: t.privacy.noSellDesc },
    { title: t.privacy.providersTitle, desc: t.privacy.providersDesc },
    { title: t.privacy.rightsTitle, desc: t.privacy.rightsDesc },
  ];

  return (
    <section id="privacy" className="scroll-mt-24 py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">{t.privacy.title}</h2>
        <p className="mt-4 text-navy/70">{t.privacy.intro}</p>

        <div className="mt-8 space-y-6">
          {items.map((item) => (
            <div key={item.title}>
              <h3 className="text-base font-semibold text-navy">{item.title}</h3>
              <p className="mt-1 text-sm text-navy/70">{item.desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-sm text-navy/70">
          {t.privacy.contactLine}{" "}
          <a href={`mailto:${siteConfig.email}`} className="inline-flex min-h-11 max-w-full touch-manipulation items-center wrap-anywhere font-semibold text-blue underline underline-offset-4">
            {siteConfig.email}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
