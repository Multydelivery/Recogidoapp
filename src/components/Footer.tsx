"use client";

import Image from "next/image";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";

export function Footer() {
  const { t } = useLanguage();
  const year = 2026;

  return (
    <footer className="bg-navy py-12 text-white/80">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white p-1.5">
              <Image src="/recogidoapplogo.png" alt="" width={32} height={32} className="h-full w-full object-contain" />
            </span>
            <div>
              <p className="text-lg font-bold text-white">{siteConfig.brandName}</p>
              <p className="mt-1 text-sm">{t.footer.tagline}</p>
              {siteConfig.isLLCConfirmed && (
                <p className="mt-1 text-sm">
                  {t.footer.operatedBy} {siteConfig.legalName}
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0 text-sm">
            <a href={`tel:${siteConfig.phone}`} className="block hover:text-white">
              {siteConfig.phoneDisplay}
            </a>
            <a href={`mailto:${siteConfig.email}`} className="mt-1 flex min-h-11 max-w-full touch-manipulation items-center wrap-anywhere underline underline-offset-4 hover:text-white">
              {siteConfig.email}
            </a>
          </div>

          <nav className="flex flex-wrap gap-4 text-sm" aria-label="Legal">
            <a href="#privacy" className="hover:text-white">
              {t.footer.privacyLink}
            </a>
            <a href="#terms" className="hover:text-white">
              {t.footer.termsLink}
            </a>
            <a href="#contact" className="hover:text-white">
              {t.nav.contact}
            </a>
          </nav>
        </div>

        <p className="mt-8 border-t border-white/10 pt-6 text-xs">
          © {year} {siteConfig.legalName}. {t.footer.rightsReserved}
        </p>
      </div>
    </footer>
  );
}
