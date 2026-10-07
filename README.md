# Recogido Dispatch — Website

A single-page marketing site for Recogido, a remote phone dispatch and communication coordination service. Built with Next.js (App Router), TypeScript, and Tailwind CSS.

Recogido provides dispatch and communication coordination only. It is not a transportation carrier, does not employ drivers, does not own vehicles, and is not affiliated with Uber, Lyft, Multy Delivery, or any other transportation company.

## 1. Install dependencies

```bash
npm install
```

## 2. Run the website locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The page hot-reloads as you edit files.

## 3. Edit business information

All editable business details live in one file: [src/config/site.ts](src/config/site.ts).

```ts
export const siteConfig = {
  brandName: "Recogido",
  shortName: "Recogido",
  legalName: "RECOGIDO LLC",
  isLLCConfirmed: true,
  phone: "+15513890281",
  phoneDisplay: "+1 551-389-0281",
  email: "admin@recogidoapp.com",
  domain: "recogidoapp.com",
  url: "https://recogidoapp.com",
};
```

Update the phone number, email, domain, or names here and the entire site (nav, hero, contact section, footer, structured data) updates automatically.

Page text (English and Spanish) lives in [src/lib/i18n/translations.ts](src/lib/i18n/translations.ts) if you need to edit the copy itself.

## 4. Business identity

The public brand is Recogido and the confirmed legal business name is RECOGIDO LLC. The contact section displays the legal name, and the footer displays the legal name in the copyright and operator information.

## 5. Contact and legal links

The site follows its existing single-page architecture: Contact, Privacy Policy, and Terms of Service are available at `/#contact`, `/#privacy`, and `/#terms`.

The contact section in [src/components/ContactForm.tsx](src/components/ContactForm.tsx) uses direct `mailto:admin@recogidoapp.com` and `tel:+15513890281` links. The nonfunctional demo form has been removed. No form submissions are collected and no success confirmations are shown. Email and call links open the visitor's configured email or phone application.

Only restore an online form once a real message-delivery implementation, failure handling, and applicable privacy disclosures are ready.

## 6. Deploy to Vercel

```bash
npm install -g vercel   # only needed once
vercel login
vercel                  # deploy a preview
vercel --prod           # deploy to production
```

Or connect the GitHub repository directly at [vercel.com/new](https://vercel.com/new) for automatic deployments on every push.

## 7. Connect recogidoapp.com (Squarespace Domains) to Vercel

1. In the Vercel dashboard, open your project → **Settings → Domains** and add `recogidoapp.com` (and `www.recogidoapp.com` if desired).
2. Vercel will show the DNS records to add (typically an `A` record pointing to `76.76.21.21` and a `CNAME` for `www` pointing to `cname.vercel-dns.com`).
3. Log in to [Squarespace Domains](https://domains.squarespace.com), select `recogidoapp.com`, and open **DNS Settings**.
4. Add/edit the records to match what Vercel specified, removing any conflicting default records (e.g. Squarespace parking records).
5. Save changes and return to Vercel — DNS propagation can take from a few minutes up to 48 hours. Vercel will show "Valid Configuration" once it detects the records and will auto-issue an SSL certificate.

## 8. Environment variables

None are required. The site uses direct email and phone links, with no message-delivery backend, API keys, or paid contact services.

## 9. Production build

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

`npm run build` must complete with no errors before deploying. `npm run start` serves the production build locally on [http://localhost:3000](http://localhost:3000).

## 10. Restaurant dispatch demo

For the restaurant-specific simulated API terminal (phase 2), see
[README-DISPATCH.md](README-DISPATCH.md). Twilio and Make remain disconnected.

Run `npm run dev` and open [http://localhost:3000/dispatch/demo](http://localhost:3000/dispatch/demo).
The public marketing page at `/` is unchanged.

This phase is **demo-only**. It does not connect to Twilio, Make, external APIs,
drivers, or a database, and needs no credentials. The online indicator represents
the simulated terminal, not a live dispatch service.

Select 1–3 deliveries or use **4+** to choose 4–9. Submission locks immediately,
waits 800 ms, and generates a `DEMO_[timestamp]` request. After five seconds of
searching, a simulated driver is assigned with a short Web Audio confirmation
when supported by the browser. A visual notice is shown if sound is unavailable.

**CANCELAR ÚLTIMA** requires browser confirmation and only works during the
search. Assigned requests cannot be cancelled. After assignment or cancellation,
**NUEVA SOLICITUD** resets the keypad. The last five requests from the current
local day are kept only in memory; refreshing or leaving the page clears them.
No localStorage is used.

## Legal notice

The Privacy Policy and Terms of Service sections included on this site are a general starting point only. **Have them reviewed by a qualified attorney before a production launch.**

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Vercel Deployment Documentation](https://nextjs.org/docs/app/building-your-application/deploying)
