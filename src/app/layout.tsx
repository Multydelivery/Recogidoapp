import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import { siteConfig } from "@/config/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: "Recogido Dispatch | Phone Dispatch Services",
  description:
    "Recogido provides remote phone dispatch and communication coordination, connecting participating businesses, dispatchers, and independent drivers.",
  openGraph: {
    title: "Recogido Dispatch | Phone Dispatch Services",
    description:
      "Recogido provides remote phone dispatch and communication coordination, connecting participating businesses, dispatchers, and independent drivers.",
    url: siteConfig.url,
    siteName: siteConfig.brandName,
    locale: "en_US",
    type: "website",
    images: ["/recogidoapplogo.png"],
  },
  icons: {
    icon: "/recogidoapplogo.png",
    apple: "/recogidoapplogo.png",
  },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: siteConfig.brandName,
  url: siteConfig.url,
  telephone: siteConfig.phone,
  email: siteConfig.email,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
