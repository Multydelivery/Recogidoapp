"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import { PhoneIcon, MailIcon, RestaurantIcon, DispatchIcon, CarIcon } from "./icons";

export function Hero() {
  const { t } = useLanguage();

  return (
    <section id="home" className="bg-navy pt-28 pb-20 sm:pt-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <h1 className="text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl">
            {t.hero.headline}
          </h1>
          <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">{t.hero.subtext}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href={`tel:${siteConfig.phone}`}
              className="inline-flex items-center gap-2 rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-dark"
            >
              <PhoneIcon className="h-4 w-4" />
              {t.hero.callDispatch}
            </a>
            <a
              href={`mailto:${siteConfig.email}`}
              className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/15"
            >
              <MailIcon className="h-4 w-4" />
              {t.hero.emailUs}
            </a>
          </div>
        </div>

        <div className="rounded-3xl bg-white p-6 shadow-xl sm:p-8">
          <ol className="flex flex-col gap-6">
            <li className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-navy">
                <RestaurantIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-navy">{t.hero.caption1}</p>
            </li>
            <li className="ml-6 h-6 w-px bg-navy/15" aria-hidden="true" />
            <li className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue/10 text-blue">
                <DispatchIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-navy">{t.hero.caption2}</p>
            </li>
            <li className="ml-6 h-6 w-px bg-navy/15" aria-hidden="true" />
            <li className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface text-navy">
                <CarIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-navy">{t.hero.caption3}</p>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
