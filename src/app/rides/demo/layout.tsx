import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Recogido Rides | Demo de viajes",
  description: "Simulación local de solicitudes de viajes asistidos. Sin viajes ni pagos reales.",
  robots: { index: false, follow: false },
};

export default function RidesDemoLayout({ children }: { children: ReactNode }) {
  return children;
}
