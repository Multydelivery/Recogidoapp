"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { DriverOffer, DriverTab } from "@/lib/driver/driver-types";
import {
  activeDeliveryCount,
  canAcceptOffer,
  createActionGate,
  createDriverDemoState,
  driverDemoPolicy,
  driverDemoReducer,
  driverDemoSimulatedDelayMs,
  orderLabel,
  visibleOffers,
  type DriverDemoAction,
} from "@/lib/driver/driver-demo";
import { ActiveDeliveries } from "./ActiveDeliveries";
import { AvailableOffers } from "./AvailableOffers";
import { DriverBottomNavigation } from "./DriverBottomNavigation";
import { DriverConfirmDialog } from "./DriverConfirmDialog";
import { DriverHeader } from "./DriverHeader";
import { DriverHistory } from "./DriverHistory";
import { DriverNotification } from "./DriverNotification";
import styles from "./DriverDemo.module.css";

const panelTitles: Record<DriverTab, string> = {
  offers: "Ofertas",
  active: "Entrega activa",
  history: "Historial",
};

/**
 * Driver interface, phase 1. DEMO ONLY: offers, deliveries and history are simulated in memory
 * (see src/lib/driver/driver-demo.ts). No network requests are made from this component.
 */
export function DriverDemo() {
  const [state, dispatch] = useReducer(driverDemoReducer, undefined, () => createDriverDemoState(Date.now()));
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [gate] = useState(createActionGate);
  const timers = useRef(new Set<number>());
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const previousTab = useRef(state.tab);

  useEffect(() => {
    const first = window.setTimeout(() => setNowMs(Date.now()), 0);
    const clock = window.setInterval(() => setNowMs(Date.now()), 15_000);
    const pending = timers.current;
    return () => {
      window.clearTimeout(first);
      window.clearInterval(clock);
      pending.forEach((id) => window.clearTimeout(id));
      pending.clear();
    };
  }, []);

  useEffect(() => {
    if (previousTab.current === state.tab) return;
    previousTab.current = state.tab;
    panelHeading.current?.focus();
  }, [state.tab]);

  const notificationId = state.notification?.id;
  const notificationTone = state.notification?.tone;
  useEffect(() => {
    if (notificationId === undefined) return;
    const timeout = window.setTimeout(() => dispatch({ type: "dismiss_notification" }),
      notificationTone === "error" ? 9000 : 6000);
    return () => window.clearTimeout(timeout);
  }, [notificationId, notificationTone]);

  const simulate = useCallback((start: DriverDemoAction, success: (at: string) => DriverDemoAction, shouldFail: boolean) => {
    if (!gate.tryEnter()) return;
    dispatch(start);
    if (shouldFail) dispatch({ type: "set_simulated_error", enabled: false });
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      gate.leave();
      dispatch(shouldFail ? { type: "action_failed" } : success(new Date().toISOString()));
    }, driverDemoSimulatedDelayMs);
    timers.current.add(id);
  }, [gate]);

  const accept = (offer: DriverOffer) => {
    if (gate.busy) return;
    if (!canAcceptOffer(state, offer).ok) {
      dispatch({ type: "accept_start", offerId: offer.offerId });
      return;
    }
    simulate({ type: "accept_start", offerId: offer.offerId },
      (at) => ({ type: "accept_success", offerId: offer.offerId, at }), state.simulateNextError);
  };

  const offers = visibleOffers(state);
  const busy = state.pending !== null;
  const confirming = state.activeDeliveries.find((delivery) => delivery.offerId === state.confirmingCompletionId);
  const activeCount = activeDeliveryCount(state);
  const counts: Record<DriverTab, number> = {
    offers: offers.length,
    active: activeCount,
    history: state.history.length,
  };

  return (
    <div className={styles.shell}>
      <DriverHeader
        firstName={state.driver.firstName}
        availability={state.availability}
        activeCount={activeCount}
        maxActive={driverDemoPolicy.maxActiveDeliveries}
        onAvailabilityChange={(availability) => dispatch({ type: "set_availability", availability })}
      />
      <div className={styles.body}>
        <DriverBottomNavigation current={state.tab} counts={counts} onSelect={(tab) => dispatch({ type: "set_tab", tab })} />
        <main className={styles.main} id={`driver-panel-${state.tab}`} aria-labelledby="driver-panel-title">
          <h2 id="driver-panel-title" ref={panelHeading} tabIndex={-1} className={styles.panelTitle}>
            {panelTitles[state.tab]}
          </h2>

          {state.tab === "offers" && (
            <AvailableOffers
              offers={offers}
              nowMs={nowMs}
              unavailable={state.availability === "unavailable"}
              pendingOfferId={state.pending?.kind === "accept" ? state.pending.offerId : null}
              busy={busy}
              checkOffer={(offer) => canAcceptOffer(state, offer)}
              onAccept={accept}
              onDecline={(offer) => dispatch({ type: "decline_offer", offerId: offer.offerId })}
              onReset={() => dispatch({ type: "reset_offers", now: Date.now() })}
            />
          )}

          {state.tab === "active" && (
            <>
              {state.availability === "unavailable" && state.activeDeliveries.length > 0 && (
                <p className={styles.unavailableNotice} role="note">
                  <strong><span aria-hidden="true">○</span> Está No disponible.</strong>{" "}
                  {activeCount > 1 ? "Sus entregas activas se conservan" : "Su entrega activa se conserva"};
                  no recibirá ofertas nuevas.
                </p>
              )}
              {state.activeDeliveries.length === 0 ? (
                <div className={styles.emptyState}>
                  <p className={styles.emptyTitle}>No tiene una entrega activa</p>
                  <p>Acepte una oferta para comenzar.</p>
                  <button type="button" className={styles.secondaryButton} onClick={() => dispatch({ type: "set_tab", tab: "offers" })}>
                    Ver ofertas
                  </button>
                </div>
              ) : (
                <ActiveDeliveries
                  deliveries={state.activeDeliveries}
                  pendingOfferId={state.pending?.offerId ?? null}
                  busy={busy}
                  onConfirmPickup={(delivery) => simulate({ type: "pickup_start", offerId: delivery.offerId },
                    (at) => ({ type: "pickup_success", offerId: delivery.offerId, at }), state.simulateNextError)}
                  onRequestCompletion={(delivery) => dispatch({ type: "request_completion", offerId: delivery.offerId })}
                />
              )}
            </>
          )}

          {state.tab === "history" && (
            <>
              <p className={styles.panelHint}>Últimas cinco entregas finalizadas en esta sesión. Datos de demostración en memoria.</p>
              <DriverHistory items={state.history} />
            </>
          )}

          <details className={styles.demoControls}>
            <summary>Controles de demostración</summary>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={state.simulateNextError}
                onChange={(event) => dispatch({ type: "set_simulated_error", enabled: event.target.checked })}
              />
              Simular un error en la próxima acción
            </label>
            <p>Interfaz simulada: no está conectada con Twilio, Make ni WhatsApp.</p>
          </details>
        </main>
      </div>

      <DriverNotification notification={state.notification} onDismiss={() => dispatch({ type: "dismiss_notification" })} />
      <DriverConfirmDialog
        open={Boolean(confirming)}
        title="¿Confirma que entregó el pedido al cliente?"
        description={confirming ? `${orderLabel(confirming.orderNumber)} · ${confirming.restaurantName}` : undefined}
        confirmLabel="SÍ, COMPLETAR ENTREGA"
        busy={state.pending?.kind === "complete"}
        onCancel={() => dispatch({ type: "cancel_completion" })}
        onConfirm={() => {
          if (!confirming) return;
          simulate({ type: "complete_start", offerId: confirming.offerId },
            (at) => ({ type: "complete_success", offerId: confirming.offerId, at }), state.simulateNextError);
        }}
      />
    </div>
  );
}
