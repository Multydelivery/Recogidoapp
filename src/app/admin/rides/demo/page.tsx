import type { Metadata } from "next";
import { RideDispatcherDemo } from "@/components/rides/RideDemo";

export const metadata: Metadata = {
  title: "Recogido Rides | Dispatcher demo",
  description: "Panel público de simulación local. No es un administrador de producción.",
  robots: { index: false, follow: false },
};

export default function RidesDispatcherDemoPage() {
  return <RideDispatcherDemo />;
}
