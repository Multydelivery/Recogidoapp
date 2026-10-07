import type { Metadata } from "next";
import { DispatchDemo } from "@/components/dispatch/DispatchDemo";

export const metadata: Metadata = {
  title: "Recogido Dispatch | Demo para restaurantes",
  description: "Simulador de solicitudes de entrega para una tableta de restaurante.",
  robots: { index: false, follow: false },
};

export default function DispatchDemoPage() {
  return <DispatchDemo />;
}
