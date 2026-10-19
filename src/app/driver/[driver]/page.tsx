import type { Metadata } from "next";
import { DriverLive } from "@/components/driver/DriverLive";
import { notFound } from "next/navigation";
import { DriverError, getDriverProfile } from "@/lib/driver/server/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recogido | Conductor",
  robots: { index: false, follow: false },
};
export default async function DriverLivePage({ params }: { params: Promise<{ driver: string }> }) {
  const { driver } = await params;
  try { getDriverProfile(driver); }
  catch (error) {
    if (error instanceof DriverError && error.statusCode === 404) notFound();
    if (error instanceof DriverError && error.statusCode === 403) return <h1>Conductor no autorizado</h1>;
    if (error instanceof DriverError && error.statusCode === 503) return <h1>Servicio de conductores no disponible.</h1>;
    throw error;
  }
  return <DriverLive key={driver} slug={driver} />;
}
