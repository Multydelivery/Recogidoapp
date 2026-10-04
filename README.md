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
  brandName: "Recogido Dispatch",
  shortName: "Recogido",
  legalName: "Recogido LLC",
  isLLCConfirmed: false,
  phone: "+15513890281",
  phoneDisplay: "+1 (551) 389-0281",
  email: "admin@recogidoapp.com",
  domain: "recogidoapp.com",
  url: "https://recogidoapp.com",
};
```

Update the phone number, email, domain, or names here and the entire site (nav, hero, contact section, footer, structured data) updates automatically.

Page text (English and Spanish) lives in [src/lib/i18n/translations.ts](src/lib/i18n/translations.ts) if you need to edit the copy itself.

## 4. Confirm or hide "Recogido LLC"

The footer only displays "Operated by Recogido LLC" when `isLLCConfirmed` is `true` in `src/config/site.ts`. Until the LLC is officially approved by the state, leave it as `false` and the site will only show the "Recogido Dispatch" brand name. Once approved, change it to:

```ts
isLLCConfirmed: true,
```

## 5. Connect the contact form

The contact form currently uses a **placeholder submission function** (`submitContactForm` in [src/components/ContactForm.tsx](src/components/ContactForm.tsx)) that only logs the submission to the browser console. **No messages are actually sent or delivered.** Connect a real backend before launch:

### Option A: Formspree

1. Create a form at [formspree.io](https://formspree.io) and copy your form endpoint (e.g. `https://formspree.io/f/xxxxxxx`).
2. Replace the body of `submitContactForm` with a `fetch` call:

```ts
async function submitContactForm(data: ContactFormData) {
  const response = await fetch("https://formspree.io/f/xxxxxxx", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error("Form submission failed");
}
```

### Option B: Resend (via a Next.js API route)

1. Add `RESEND_API_KEY` to your environment variables (see below).
2. Create `src/app/api/contact/route.ts` that uses the [Resend SDK](https://resend.com/docs) to send an email to `admin@recogidoapp.com`.
3. Update `submitContactForm` to `fetch("/api/contact", { method: "POST", body: JSON.stringify(data) })`.

Whichever service you choose, keep API keys server-side (environment variables, never committed to git).

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

None are required to run the site as-is (the contact form is a placeholder). If you connect a real form backend:

| Variable | Used for |
| --- | --- |
| `RESEND_API_KEY` | Required only if you implement the Resend API route option above. |

Set variables locally in a `.env.local` file (already git-ignored) and in **Vercel → Settings → Environment Variables** for deployed environments.

## 9. Production build

```bash
npm run build
npm run start
```

`npm run build` must complete with no errors before deploying. `npm run start` serves the production build locally on [http://localhost:3000](http://localhost:3000).

## Legal notice

The Privacy Policy and Terms of Service sections included on this site are a general starting point only. **Have them reviewed by a qualified attorney before a production launch.**

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Vercel Deployment Documentation](https://nextjs.org/docs/app/building-your-application/deploying)

