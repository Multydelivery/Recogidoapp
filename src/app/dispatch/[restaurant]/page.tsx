import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DispatchTerminal } from "@/components/dispatch/DispatchTerminal";
import { DispatchError, getRestaurants, isDispatchMockMode } from "@/lib/dispatch/server/config";
import { DispatchFrame } from "@/components/dispatch/DispatchFrame";
import styles from "@/components/dispatch/DispatchDemo.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recogido Dispatch | Terminal de restaurante",
  robots: { index: false, follow: false },
};

export default async function RestaurantDispatchPage({ params }: {
  params: Promise<{ restaurant: string }>;
}) {
  const { restaurant: slug } = await params;
  let restaurants;
  try {
    restaurants = getRestaurants();
  } catch (error: unknown) {
    if (!(error instanceof DispatchError)) throw error;
    console.error("Dispatch configuration error:", error.message);
    return (
      <DispatchFrame restaurantName="Terminal sin configurar" now={null} connected={false}>
        <section className={styles.orderCard}>
          <div className={styles.cardContent}>
            <h1 className={styles.title}>Configuración pendiente</h1>
            <p role="alert">{error.message} Consulta README-DISPATCH para configurar el simulador.</p>
          </div>
        </section>
      </DispatchFrame>
    );
  }
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  if (!restaurant) notFound();
  return <DispatchTerminal key={slug} restaurant={{ slug: restaurant.slug, name: restaurant.name }} initialMockMode={isDispatchMockMode()} />;
}
