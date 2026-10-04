"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { CarIcon } from "./icons";

export function ForDrivers() {
  const { t } = useLanguage();

  return (
    <section className="py-20">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-6 px-4 text-center sm:px-6">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-blue/10 text-blue">
          <CarIcon className="h-7 w-7" />
        </span>
        <h2 className="text-2xl font-bold text-navy sm:text-3xl">{t.forDrivers.title}</h2>
        <p className="max-w-2xl text-navy/70">{t.forDrivers.desc}</p>
      </div>
    </section>
  );
}
