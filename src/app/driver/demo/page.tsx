import type { Metadata } from "next";
import { DriverDemo } from "@/components/driver/DriverDemo";

export const metadata: Metadata = {
  title: "Recogido | Demo para conductores",
  description: "Simulación de la interfaz móvil para conductores de Recogido.",
  robots: { index: false, follow: false },
};

export default function DriverDemoPage() {
  return <DriverDemo />;
}
