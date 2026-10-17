"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createDriverLiveController } from "@/lib/driver/live-controller";
import type { DriverTab } from "@/lib/driver/driver-types";
import { formatDriverTime } from "@/lib/driver/driver-demo";
import { DriverHeader } from "./DriverHeader";
import { DriverBottomNavigation } from "./DriverBottomNavigation";
import { DriverConfirmDialog } from "./DriverConfirmDialog";
import { OfferCard } from "./OfferCard";
import { ActiveDeliveryCard } from "./ActiveDeliveryCard";
import styles from "./DriverDemo.module.css";

const titles = { offers: "Ofertas", active: "Entregas activas", history: "Historial" };
export function DriverLive() {
  const [controller] = useState(() => createDriverLiveController({
    fetch: (...args) => fetch(...args),
    storage: {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    },
    visible: () => document.visibilityState === "visible",
    setInterval: (callback, ms) => setInterval(callback, ms), clearInterval: (id) => clearInterval(id),
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [pin, setPin] = useState("");
  const [tab, setTab] = useState<DriverTab>("offers");
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { void controller.start(); return controller.stop; }, [controller]);
  const dashboard = state.dashboard;
  return (
    <div className={styles.shell}>
      {!state.authenticated ? (
        <main className={styles.main}>
          <h1 className={styles.panelTitle}>Ingrese el PIN de este conductor</h1>
          <form className={styles.card} onSubmit={(event) => {
            event.preventDefault();
            const submitted = pin;
            setPin("");
            void controller.login(submitted);
          }}>
            <label htmlFor="driver-pin">PIN</label>
            <input id="driver-pin" type="password" autoComplete="off" maxLength={128}
              value={pin} onChange={(event) => setPin(event.target.value)} required disabled={state.loading} />
            <button className={styles.primaryButton} disabled={state.loading}> {state.loading ? "Conectando…" : "Ingresar"}</button>
          </form>
        </main>
      ) : (
        <>
          {dashboard && <DriverHeader live firstName={dashboard.driver.name.split(" ")[0]}
            availability={dashboard.driver.available ? "available" : "unavailable"}
            activeCount={dashboard.capacity.used} maxActive={dashboard.capacity.maximum}
            availabilityDisabled={state.pending.has("availability")}
            onAvailabilityChange={(value) => void controller.act({ action: "set_availability", available: value === "available" })} />}
          <div className={styles.body}>
            <main className={styles.main} id={`driver-panel-${tab}`} aria-labelledby="driver-panel-title">
              <button type="button" className={styles.secondaryButton} onClick={() => {
                setPin(""); setConfirming(null); controller.logout();
              }}>Cerrar sesión</button>
              <h2 id="driver-panel-title" className={styles.panelTitle}>{titles[tab]}</h2>
              {state.refreshing && <p className={styles.panelHint}>Actualizando…</p>}
              {!dashboard && <button className={styles.secondaryButton} onClick={() => void controller.refresh()}>Reintentar carga</button>}
              {tab === "offers" && dashboard && (
                <ul className={styles.list}>
                  {dashboard.offers.length === 0 && <li className={styles.emptyState}>No hay ofertas disponibles.</li>}
                  {dashboard.offers.map((offer) => (
                    <li key={offer.orderNumber}>
                      <OfferCard offer={{ ...offer, offerId: offer.orderNumber, createdAt: offer.createdAt ?? "",
                        status: "available", assignedAt: null, pickedUpAt: null, completedAt: null }}
                        nowMs={state.refreshedAt} loading={state.pending.has(offer.orderNumber)}
                        actionsDisabled={state.pending.has(offer.orderNumber)} disableBlocked
                        acceptBlockedReason={!offer.canAccept ? offer.blockReason : undefined}
                        onAccept={() => void controller.act({ action: "accept", orderNumber: offer.orderNumber })}
                        onDecline={() => void controller.act({ action: "decline", orderNumber: offer.orderNumber })} />
                    </li>
                  ))}
                </ul>
              )}
              {tab === "active" && dashboard && (
                <ul className={styles.list}>
                  {dashboard.activeDeliveries.length === 0 && <li className={styles.emptyState}>No tiene entregas activas.</li>}
                  {dashboard.activeDeliveries.map((delivery) => (
                    <li key={delivery.orderNumber}>
                      <ActiveDeliveryCard delivery={{ ...delivery, offerId: delivery.orderNumber,
                        status: delivery.status === "picked_up" ? "picked_up" : "assigned",
                        pickedUpAt: delivery.pickedUpAt ?? null, completedAt: delivery.completedAt ?? null,
                        driverName: dashboard.driver.name }}
                        loading={state.pending.has(delivery.orderNumber)} disabled={state.pending.has(delivery.orderNumber)}
                        onConfirmPickup={() => void controller.act({ action: "pickup", orderNumber: delivery.orderNumber })}
                        onRequestCompletion={() => setConfirming(delivery.orderNumber)} />
                    </li>
                  ))}
                </ul>
              )}
              {tab === "history" && dashboard && (
                <ul className={styles.list}>
                  {dashboard.history.length === 0 && <li className={styles.emptyState}>No hay entregas en el historial.</li>}
                  {dashboard.history.map((delivery) => (
                    <li className={styles.historyItem} key={delivery.orderNumber}>
                      <h3 className={styles.historyOrder}>{delivery.orderNumber}</h3>
                      <p className={styles.restaurant}>{delivery.restaurantName}</p>
                      <p>{delivery.assignmentLabel}</p><p>{delivery.status}</p>
                      <dl className={styles.historyFacts}>
                        {(["assignedAt", "pickedUpAt", "completedAt"] as const).map((key) => (
                          <div key={key}><dt>{{ assignedAt: "Asignada", pickedUpAt: "Recogida", completedAt: "Finalizada" }[key]}</dt>
                            <dd>{delivery[key] ? <time dateTime={delivery[key]}>{formatDriverTime(delivery[key])}</time> : "—"}</dd></div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ul>
              )}
            </main>
            <DriverBottomNavigation current={tab} onSelect={setTab} counts={{
              offers: dashboard?.offers.length ?? 0, active: dashboard?.activeDeliveries.length ?? 0, history: dashboard?.history.length ?? 0,
            }} />
          </div>
          <DriverConfirmDialog open={confirming !== null} title="¿Confirma que entregó el pedido al cliente?"
            description={confirming ?? undefined} confirmLabel="COMPLETAR ENTREGA"
            busy={confirming !== null && state.pending.has(confirming)} onCancel={() => setConfirming(null)}
            onConfirm={() => {
              if (!confirming) return;
              void controller.act({ action: "complete", orderNumber: confirming });
              setConfirming(null);
            }} />
        </>
      )}
      <p className={styles.panelHint} role="status" aria-live="polite" aria-atomic="true">{state.message}</p>
    </div>
  );
}
