import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DispatchTerminal } from "@/components/dispatch/DispatchTerminal";
import { DispatchError, getDispatchCapabilities, getRestaurants, isLiveTestConfigurationIncomplete, isLiveTestPilotRequested, resolveDispatchMode } from "@/lib/dispatch/server/config";
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
  const livePilotRequested = isLiveTestPilotRequested(slug);
  let restaurants;
  try {
    restaurants = getRestaurants();
  } catch (error: unknown) {
    if (!(error instanceof DispatchError)) throw error;
    return (
      <DispatchFrame restaurantName="Terminal sin configurar" now={null} connected={false} mockMode={!livePilotRequested} configurationIncomplete={livePilotRequested}>
        <section className={styles.orderCard}>
          <div className={styles.cardContent}>
            <h1 className={styles.title}>Configuración pendiente</h1>
            <p role="alert">
              {error.message} Configura <code>RESTAURANTS_JSON</code> en el entorno
              del servidor usando <code>.env.example</code> como referencia y
              reinicia Next.js. No copies credenciales privadas al archivo de ejemplo.
            </p>
          </div>
        </section>
      </DispatchFrame>
    );
  }
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  if (!restaurant && livePilotRequested) {
    return (
      <DispatchFrame restaurantName="Restaurante de prueba" now={null} connected={false} mockMode={false} configurationIncomplete>
        <section className={styles.orderCard}>
          <div className={styles.cardContent}>
            <h1 className={styles.title}>Configuración incompleta</h1>
            <p role="alert">El perfil autenticable de <code>restaurant-test</code> no está configurado en <code>RESTAURANTS_JSON</code>.</p>
          </div>
        </section>
      </DispatchFrame>
    );
  }
  if (!restaurant) notFound();
  return <DispatchTerminal
    key={slug}
    restaurant={{ slug: restaurant.slug, name: restaurant.name }}
    initialMockMode={resolveDispatchMode(slug) !== "twilio"}
    initialCapabilities={getDispatchCapabilities(slug)}
    initialConfigurationIncomplete={isLiveTestConfigurationIncomplete(slug)}
  />;
}
