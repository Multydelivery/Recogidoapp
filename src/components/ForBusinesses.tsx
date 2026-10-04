"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import { RestaurantIcon, PhoneIcon } from "./icons";

export function ForBusinesses() {
  const { t } = useLanguage();

  return (
    <section className="bg-surface py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 text-center sm:px-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy text-white">
          <RestaurantIcon className="h-7 w-7" />
        </span>
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">{t.forBusinesses.title}</h2>
        <p className="max-w-2xl text-navy/70">{t.forBusinesses.desc}</p>
        <a
          href={`tel:${siteConfig.phone}`}
          className="inline-flex items-center gap-2 rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-dark"
        >
          <PhoneIcon className="h-4 w-4" />
          {t.forBusinesses.cta}
        </a>
      </div>
    </section>
  );
}
