"use client";

import { useState } from "react";
import Image from "next/image";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { PhoneIcon } from "./icons";

const links = [
  { href: "#home", key: "home" as const },
  { href: "#how-it-works", key: "howItWorks" as const },
  { href: "#services", key: "services" as const },
  { href: "#contact", key: "contact" as const },
];

export function Header() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-black/5 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <a href="#home" className="flex items-center gap-2 text-lg font-bold text-navy">
          <Image src="/recogidoapplogo.png" alt="" width={36} height={36} className="h-9 w-9" priority />
          {siteConfig.brandName}
        </a>

        <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
          {links.map((link) => (
            <a
              key={link.key}
              href={link.href}
              className="text-sm font-medium text-navy/80 hover:text-blue"
            >
              {t.nav[link.key]}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <LanguageSwitcher />
          <a
            href={`tel:${siteConfig.phone}`}
            className="inline-flex items-center gap-2 rounded-full bg-blue px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-dark"
          >
            <PhoneIcon className="h-4 w-4" />
            {t.nav.callDispatch}
          </a>
        </div>

        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-navy md:hidden"
          aria-expanded={open}
          aria-label="Toggle menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">Menu</span>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.75}>
            {open ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-black/5 bg-white px-4 pb-4 md:hidden">
          <nav className="flex flex-col gap-1 pt-2" aria-label="Mobile">
            {links.map((link) => (
              <a
                key={link.key}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm font-medium text-navy/80 hover:bg-surface"
              >
                {t.nav[link.key]}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3">
            <LanguageSwitcher />
            <a
              href={`tel:${siteConfig.phone}`}
              className="inline-flex items-center gap-2 rounded-full bg-blue px-4 py-2 text-sm font-semibold text-white"
            >
              <PhoneIcon className="h-4 w-4" />
              {t.nav.callDispatch}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}
