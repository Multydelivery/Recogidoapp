"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";

export function Terms() {
  const { t } = useLanguage();

  const paragraphs = [t.terms.p1, t.terms.p2, t.terms.p3, t.terms.p4, t.terms.p5, t.terms.p6];

  return (
    <section id="terms" className="scroll-mt-24 bg-surface py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">{t.terms.title}</h2>

        <ul className="mt-6 space-y-3 text-sm text-navy/70">
          {paragraphs.map((paragraph) => (
            <li key={paragraph} className="list-disc pl-1 marker:text-blue">
              {paragraph}
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-navy/70">
          {t.terms.contactLine}{" "}
          <a href={`mailto:${siteConfig.email}`} className="font-semibold text-blue">
            {siteConfig.email}
          </a>
          .
        </p>
      </div>
    </section>
  );
}
