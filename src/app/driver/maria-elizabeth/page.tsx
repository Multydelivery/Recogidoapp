import type { Metadata } from "next";
import { DriverLive } from "@/components/driver/DriverLive";

export const metadata: Metadata = {
  title: "Recogido | Conductor",
  robots: { index: false, follow: false },
};
export default function DriverLivePage() { return <DriverLive />; }
