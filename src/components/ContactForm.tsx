"use client";

import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import { PhoneIcon, MailIcon } from "./icons";

export function ContactForm() {
  const { t } = useLanguage();

  return (
    <section id="contact" aria-labelledby="contact-title" className="scroll-mt-24 bg-surface py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 id="contact-title" className="text-2xl font-bold text-navy sm:text-3xl">{t.contact.title}</h2>
          <p className="mt-4 text-navy/70">{t.contact.description}</p>

          <dl className="mt-8 space-y-4 text-sm">
            <div>
              <dt className="font-medium text-navy/60">{t.contact.businessLabel}</dt>
              <dd className="font-semibold text-navy">{siteConfig.legalName}</dd>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-white">
                <PhoneIcon className="h-5 w-5" />
              </span>
              <div>
                <dt className="font-medium text-navy/60">{t.contact.phoneLabel}</dt>
                <dd>
                  <a href={`tel:${siteConfig.phone}`} className="font-semibold text-navy hover:text-blue">
                    {siteConfig.phoneDisplay}
                  </a>
                </dd>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-white">
                <MailIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <dt className="font-medium text-navy/60">{t.contact.emailLabel}</dt>
                <dd>
                  <a href={`mailto:${siteConfig.email}`} className="wrap-break-word font-semibold text-navy hover:text-blue">
                    {siteConfig.email}
                  </a>
                </dd>
              </div>
            </div>

            <div>
              <dt className="font-medium text-navy/60">{t.contact.websiteLabel}</dt>
              <dd>
                <a href={siteConfig.url} className="wrap-break-word font-semibold text-navy hover:text-blue">
                  {siteConfig.url}
                </a>
              </dd>
            </div>

            <div>
              <dt className="font-medium text-navy/60">{t.contact.serviceTypeLabel}</dt>
              <dd className="font-semibold text-navy">{t.contact.serviceTypeValue}</dd>
            </div>
          </dl>

          <p className="mt-8 rounded-2xl border border-navy/10 bg-white px-5 py-4 text-xs text-navy/70">
            {t.messagingConsent.text}
          </p>
        </div>

        <div className="min-w-0 self-start lg:pt-2">
          <p className="text-sm leading-relaxed text-navy/70">{t.contact.formUnavailable}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a
              href={`mailto:${siteConfig.email}`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue"
            >
              <MailIcon className="h-5 w-5" />
              {t.contact.emailUs}
            </a>
            <a
              href={`tel:${siteConfig.phone}`}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-navy px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-navy"
            >
              <PhoneIcon className="h-5 w-5" />
              {t.contact.callUs}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
