"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { PhoneIcon, DispatchIcon, CarIcon } from "./icons";

export function Services() {
  const { t } = useLanguage();

  const cards = [
    { icon: PhoneIcon, title: t.services.card1Title, desc: t.services.card1Desc },
    { icon: DispatchIcon, title: t.services.card2Title, desc: t.services.card2Desc },
    { icon: CarIcon, title: t.services.card3Title, desc: t.services.card3Desc },
  ];

  return (
    <section id="services" className="py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-center text-2xl font-bold text-navy sm:text-3xl">{t.services.title}</h2>

        <div className="mt-12 grid gap-8 sm:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-2xl border border-navy/10 p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy text-white">
                <card.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 text-lg font-semibold text-navy">{card.title}</h3>
              <p className="mt-2 text-sm text-navy/70">{card.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
