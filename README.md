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

For the authenticated restaurant terminal, Mock Mode, and the future Twilio
Functions contract, see
[README-DISPATCH.md](README-DISPATCH.md). Twilio and Make remain disconnected.

Run `npm run dev` and open [http://localhost:3000/dispatch/demo](http://localhost:3000/dispatch/demo).
The public marketing page at `/` is unchanged.

The demo has individual (La Fonda, maximum 3) and batch (Brisas, maximum 5)
scenarios. Individual requests create one card per delivery; batch requests
create one card for the whole lot. The mock assigns deliveries progressively,
shows the 20-second pending alert, and lets the operator reoffer or cancel only
open deliveries. The PIN-protected `/dispatch/[restaurantId]` terminal uses the
same mock contracts and keeps the public marketing page unchanged.

Both paths run without Twilio, Make, or other external APIs while
`DISPATCH_MOCK_MODE=true`.

## 11. Public restaurant ordering demo

The public menu demonstration is available at
`/order/la-fonda-paisa`. Its static catalog lives in
`src/data/la-fonda-paisa-menu.json` and contains **27 products** in eight categories.
The public-menu review and reusable modifier templates are in
`src/data/la-fonda-paisa-modifiers-phase-1.json`; the ordering page resolves
each product's `modifierGroupRefs` against shared templates without copying
the groups.

Bandeja Paisa, Paisita, Especial de crema de pollo, and Especial de sopa de
mondongo are configurable. Picada remains direct-add. All four configurable
dishes can have optional sides, desserts, beverages, and special instructions;
the bandejas require a protein, and both soups require size, rice, and a salad
or beans. Soup prices use $12.35 as the 1,235-cent base and add 260 cents for
Grande, for an exact $14.95 total.

The phase-1 prices and options were publicly observed on DoorDash on October
19, 2026 (`publiclyVerified: true`, `merchantConfirmed: false`). Internal note:
La Fonda Paisa must confirm all prices before any real ordering capability is
considered. This demo does not accept real orders or payments and makes no
external service requests.

The browser cart is stored under `recogido:cart:la-fonda-paisa` using schema
version 2. If the new key is absent, the first read validates `recogido:cart`,
retains only La Fonda product IDs, writes valid lines to the new key, and
records a one-time migration marker. The old key is left untouched; later
reads never import it again. Invalid lines and corrupt JSON are discarded
without breaking the page. Cart lines retain product ID, quantity, selected
modifier snapshots, configured unit price in cents, special instructions, and
a deterministic configuration key.

This remains a demonstration only. It does not submit orders, process payments,
or contact the restaurant. Address details exist only in page memory while the
checkout is open and are cleared when leaving or completing it; they are never
stored or sent to a server. The checkout clearly states that no order will be
sent.

Run `npm run dev` and open
[http://localhost:3000/order/la-fonda-paisa](http://localhost:3000/order/la-fonda-paisa).
Run the focused menu and cart tests with:

```bash
npm run test:ordering
```

The menu's fixed **Continuar con La Fonda** bar opens the four-step demo
checkout at `/order/la-fonda-paisa/checkout`. It reuses the version-2 cart and
existing modifier/pricing logic. Delivery details stay in component memory only:
they are not placed in the URL, written to browser storage, logged, or sent to
an API. The final review shows the food subtotal as a partial total while
service fee, delivery fee, and tax remain explicitly pending until approved
values are configured. The last step creates only a local demonstration
confirmation; it does not submit an order or process payment. No payment fields
or provider integrations are included.

Before a future live-ordering phase, obtain restaurant approval for the catalog,
then design and implement the required order submission, fulfillment, payment,
and privacy workflows. None of those live capabilities are enabled here.

## Legal notice

The Privacy Policy and Terms of Service sections included on this site are a general starting point only. **Have them reviewed by a qualified attorney before a production launch.**

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Vercel Deployment Documentation](https://nextjs.org/docs/app/building-your-application/deploying)
