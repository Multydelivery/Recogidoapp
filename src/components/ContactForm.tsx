"use client";

import { useState, type FormEvent } from "react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import { PhoneIcon, MailIcon, CheckIcon } from "./icons";

/**
 * Placeholder submission handler.
 *
 * This does NOT send data anywhere — no backend is connected. Replace this
 * function with a real integration (Formspree, Resend, etc.) before launch.
 * See README.md for step-by-step instructions.
 */
async function submitContactForm(data: {
  name: string;
  business: string;
  phone: string;
  email: string;
  message: string;
  consent: boolean;
}): Promise<void> {
  console.log("Contact form submitted (demo only, not sent anywhere):", data);
  return Promise.resolve();
}

export function ContactForm() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"idle" | "submitting" | "submitted">("idle");
  const [consent, setConsent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setStatus("submitting");

    await submitContactForm({
      name: String(formData.get("name") ?? ""),
      business: String(formData.get("business") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? ""),
      message: String(formData.get("message") ?? ""),
      consent,
    });

    setStatus("submitted");
    form.reset();
    setConsent(false);
  }

  return (
    <section id="contact" className="bg-surface py-20">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="text-2xl font-bold text-navy sm:text-3xl">{t.contact.title}</h2>

          <dl className="mt-8 space-y-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white">
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
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-navy text-white">
                <MailIcon className="h-5 w-5" />
              </span>
              <div>
                <dt className="font-medium text-navy/60">{t.contact.emailLabel}</dt>
                <dd>
                  <a href={`mailto:${siteConfig.email}`} className="font-semibold text-navy hover:text-blue">
                    {siteConfig.email}
                  </a>
                </dd>
              </div>
            </div>

            <div>
              <dt className="font-medium text-navy/60">{t.contact.websiteLabel}</dt>
              <dd className="font-semibold text-navy">{siteConfig.domain}</dd>
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

        <form onSubmit={handleSubmit} className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
          <h3 className="text-lg font-semibold text-navy">{t.contact.formTitle}</h3>

          <div className="mt-5 grid gap-4">
            <label className="text-sm font-medium text-navy">
              {t.contact.formName}
              <input
                required
                name="name"
                type="text"
                className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-blue"
              />
            </label>

            <label className="text-sm font-medium text-navy">
              {t.contact.formBusiness}
              <input
                name="business"
                type="text"
                className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-blue"
              />
            </label>

            <label className="text-sm font-medium text-navy">
              {t.contact.formPhone}
              <input
                required
                name="phone"
                type="tel"
                className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-blue"
              />
            </label>

            <label className="text-sm font-medium text-navy">
              {t.contact.formEmail}
              <input
                required
                name="email"
                type="email"
                className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-blue"
              />
            </label>

            <label className="text-sm font-medium text-navy">
              {t.contact.formMessage}
              <textarea
                required
                name="message"
                rows={4}
                className="mt-1 w-full rounded-lg border border-navy/15 px-3 py-2 text-sm text-navy focus:border-blue"
              />
            </label>

            <label className="flex items-start gap-2 text-xs text-navy/70">
              <input
                required
                type="checkbox"
                name="consent"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-navy/30"
              />
              {t.contact.consentText}
            </label>
          </div>

          <button
            type="submit"
            disabled={status === "submitting"}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-blue px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-dark disabled:opacity-60"
          >
            {status === "submitted" ? <CheckIcon className="h-4 w-4" /> : null}
            {t.contact.submit}
          </button>

          {status === "submitted" && (
            <p role="status" className="mt-3 text-sm text-navy/70">
              {t.contact.successMessage}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
