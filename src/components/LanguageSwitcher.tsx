"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { Language } from "@/lib/i18n/translations";

const options: { code: Language; label: string }[] = [
  { code: "en", label: "EN" },
  { code: "es", label: "ES" },
];

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      role="group"
      aria-label="Language selector"
      className={`inline-flex items-center rounded-full border border-navy/15 bg-white p-0.5 text-sm font-medium ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.code}
          type="button"
          onClick={() => setLanguage(option.code)}
          aria-pressed={language === option.code}
          className={`rounded-full px-2.5 py-1 transition-colors cursor-pointer ${
            language === option.code
              ? "bg-navy text-white"
              : "text-navy/70 hover:text-navy"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
