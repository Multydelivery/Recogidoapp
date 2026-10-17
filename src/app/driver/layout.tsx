import type { Metadata, Viewport } from "next";
import { DriverPwa } from "@/components/driver/DriverPwa";

export const metadata: Metadata = {
  manifest: "/driver-manifest.webmanifest",
  applicationName: "Recogido Conductor",
  appleWebApp: { capable: true, title: "Recogido", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/driver/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/driver/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#14b8ab",
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <div lang="es"><DriverPwa />{children}</div>;
}
