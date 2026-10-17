"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DispatchApiError, dispatchApi } from "@/lib/dispatch/client";
import {
  isOpenRequest,
  type DispatchCapabilities,
  type DispatchRequest,
  type DispatchSnapshot,
  type RestaurantPublic,
} from "@/lib/dispatch/dispatch-types";
import {
  canCancelRequest,
  canResendRequest,
  cancelConfirmationText,
  cancellationResultText,
  formatLastUpdate,
  partitionActive,
} from "@/lib/dispatch/dispatch-queue";
import { formatOrderNumber, requestOrderNumber, summarizeDeliveryBoard } from "@/lib/dispatch/delivery-progress";
import { announce, type DispatchNotification } from "@/lib/dispatch/dispatch-notifications";
import { createSoundPlayer } from "@/lib/dispatch/dispatch-sounds";
import {
  readPendingAttempt,
  readSavedPin,
  removeSavedPin as removeStoredPin,
  savePin as storePin,
  terminalStorageKeys,
} from "@/lib/dispatch/terminal-storage";
import { useDispatchQueue } from "./useDispatchQueue";
import { DispatchHeader, type TerminalConnection } from "./DispatchHeader";
import { NewDeliveryRequest } from "./NewDeliveryRequest";
import { DispatchSummary } from "./DispatchSummary";
import { ActiveDeliveriesSection } from "./ActiveDeliveriesSection";
import type { CardActions } from "./DeliveryRequestGroup";
import { ConnectionBanner } from "./ConnectionBanner";
import { NotificationCenter } from "./NotificationCenter";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
import { DeliveryHistorySection } from "./DeliveryHistorySection";
import styles from "./DispatchTerminal.module.css";

const mockCapabilities: DispatchCapabilities = {
  liveDispatch: false,
  canCreate: true,
  canReadStatus: true,
  canCancel: true,
  canResend: true,
  canLoadHistory: true,
  canLoadActive: false,
};

const maxToasts = 4;
const genericFailure = "No se pudo contactar al servidor. La operación no se confirmó; intente de nuevo.";

type ConfirmState =
  | { kind: "submit"; count: number }
  | { kind: "cancel"; request: DispatchRequest }
  | null;

type BusyAction = { kind: "resend" | "cancel"; requestId: string } | null;

function isAuthError(error: unknown): boolean {
  if (error instanceof DispatchApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) return true;
    if (typeof error.message === "string" && error.message.includes("Token o PIN inválido")) return true;
  }
  return false;
}

function failureMessage(error: unknown) {
  return error instanceof DispatchApiError && error.statusCode > 0 && error.message ? error.message : genericFailure;
}

export function DispatchTerminal({ restaurant, initialMockMode = true, initialCapabilities = mockCapabilities, initialConfigurationIncomplete = false }: {
  restaurant: Pick<RestaurantPublic, "slug" | "name">;
  initialMockMode?: boolean;
  initialCapabilities?: DispatchCapabilities;
  initialConfigurationIncomplete?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [configuration, setConfiguration] = useState<RestaurantPublic | null>(null);
  const [operationStatus, setOperationStatus] = useState<DispatchSnapshot["operationStatus"]>();
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [mockMode, setMockMode] = useState(initialMockMode);
  const [configurationIncomplete, setConfigurationIncomplete] = useState(initialConfigurationIncomplete);
  const [message, setMessage] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [toasts, setToasts] = useState<DispatchNotification[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const attempt = useRef<{ key: string; count: number } | null>(null);
  const mutedRef = useRef(false);
  const sounds = useRef<ReturnType<typeof createSoundPlayer> | null>(null);
  const slug = restaurant.slug;
  const { pendingAttempt: pendingKey, soundMuted: soundKey } = terminalStorageKeys(slug);
  const capabilities = initialCapabilities;

  const storageFailure = useCallback(() => {
    setStorageNotice("El navegador no permite guardar el PIN. Tendrá que ingresarlo de nuevo al recargar.");
  }, []);

  const getSavedPin = useCallback((): string | null => {
    try {
      return readSavedPin(localStorage, slug);
    } catch {
      storageFailure();
      return null;
    }
  }, [slug, storageFailure]);

  const savePin = useCallback((pinValue: string) => {
    try {
      storePin(localStorage, slug, pinValue);
    } catch {
      storageFailure();
    }
  }, [slug, storageFailure]);

  const removeSavedPin = useCallback(() => {
    try {
      removeStoredPin(localStorage, slug);
    } catch {
      storageFailure();
    }
  }, [slug, storageFailure]);

  const applySnapshot = useCallback((data: DispatchSnapshot) => {
    setMockMode(data.mockMode);
    setConfiguration(data.restaurant);
    setOperationStatus(data.operationStatus);
  }, []);

  const pushToasts = useCallback((notifications: readonly DispatchNotification[]) => {
    setToasts((previous) => [...previous, ...notifications].slice(-maxToasts));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const handleNotifications = useCallback((notifications: readonly DispatchNotification[]) => {
    if (!mounted.current) return;
    announce(notifications, {
      muted: mutedRef.current,
      play: (sound) => sounds.current?.play(sound),
      push: pushToasts,
    });
  }, [pushToasts]);

  const resetSession = useCallback((nextMessage: string | null) => {
    controller.current?.abort();
    controller.current = new AbortController();
    removeSavedPin();
    setToken(null);
    setPin("");
    setConfiguration(null);
    setOperationStatus(undefined);
    setDeliveryCount(null);
    setLastCreated(null);
    setToasts([]);
    setConfirm(null);
    setRestoreFailed(false);
    setMessage(nextMessage);
    setInitializing(false);
  }, [removeSavedPin]);

  const handleAuthFailure = useCallback(() => {
    resetSession("PIN incorrecto. Inténtelo nuevamente.");
  }, [resetSession]);

  const queue = useDispatchQueue({
    restaurantId: restaurant.slug,
    token,
    capabilities,
    onAuthError: handleAuthFailure,
    onNotifications: handleNotifications,
    onSnapshot: applySnapshot,
  });
  const { clear: clearQueue, seed: seedQueue, applyServerRequest } = queue;

  const handleFailure = useCallback((error: unknown, signal?: AbortSignal) => {
    if (!mounted.current || signal?.aborted) return;
    if (isAuthError(error)) {
      clearQueue();
      handleAuthFailure();
      return;
    }
    setConfigurationIncomplete(error instanceof DispatchApiError && error.code === "NOT_CONFIGURED");
    setMessage(failureMessage(error));
  }, [clearQueue, handleAuthFailure]);

  /**
   * Validates a PIN with the existing contracts: config, then status when supported. The real
   * history is loaded separately by the queue controller, never on every poll.
   */
  const connect = useCallback(async (candidate: string, signal: AbortSignal) => {
    const configured = await dispatchApi("config", restaurant.slug, candidate, signal);
    return capabilities.canReadStatus
      ? await dispatchApi("status", restaurant.slug, candidate, signal)
      : configured;
  }, [restaurant.slug, capabilities.canReadStatus]);

  const activate = useCallback((candidate: string, data: DispatchSnapshot) => {
    applySnapshot(data);
    setConfigurationIncomplete(initialConfigurationIncomplete);
    // The active endpoint baselines the queue on its first poll; otherwise track the request found here.
    if (!capabilities.canLoadActive) seedQueue(data.request);
    setToken(candidate);
    setMessage(null);
    setRestoreFailed(false);
  }, [applySnapshot, capabilities.canLoadActive, initialConfigurationIncomplete, seedQueue]);

  const restoreDevice = useCallback(async () => {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    try {
      const preference = localStorage.getItem(soundKey) === "1";
      mutedRef.current = preference;
      setMuted(preference);
    } catch {}
    const saved = getSavedPin();
    if (!saved) {
      setInitializing(false);
      return;
    }
    setInitializing(true);
    setRestoreFailed(false);
    setMessage(null);
    try {
      const pending = readPendingAttempt(localStorage, slug);
      if (pending) attempt.current = pending;
    } catch { storageFailure(); }
    try {
      const data = await connect(saved, abort.signal);
      if (!abort.signal.aborted && mounted.current) activate(saved, data);
    } catch (error: unknown) {
      if (abort.signal.aborted || !mounted.current) return;
      if (isAuthError(error)) {
        resetSession("PIN incorrecto. Inténtelo nuevamente.");
      } else {
        setRestoreFailed(true);
        setConfigurationIncomplete(error instanceof DispatchApiError && error.code === "NOT_CONFIGURED");
      }
    } finally {
      if (mounted.current && !abort.signal.aborted) setInitializing(false);
    }
  }, [soundKey, slug, getSavedPin, storageFailure, connect, activate, resetSession]);

  useEffect(() => {
    mounted.current = true;
    sounds.current = createSoundPlayer();
    const clock = setInterval(() => setNowMs(Date.now()), 1000);
    const start = setTimeout(() => void restoreDevice(), 0);
    return () => {
      mounted.current = false;
      clearTimeout(start);
      controller.current?.abort();
      clearInterval(clock);
      sounds.current?.dispose();
      sounds.current = null;
    };
  }, [restoreDevice]);

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authenticating || busy.current || !pin.trim()) return;
    sounds.current?.unlock();
    busy.current = true;
    setAuthenticating(true);
    setMessage(null);
    const candidate = pin.trim();
    const authController = new AbortController();
    controller.current?.abort();
    controller.current = authController;
    try {
      const data = await connect(candidate, authController.signal);
      if (!mounted.current || authController.signal.aborted) return;
      activate(candidate, data);
      setPin("");
      savePin(candidate);
    } catch (error: unknown) {
      if (!mounted.current || authController.signal.aborted) return;
      if (isAuthError(error)) resetSession("PIN incorrecto. Inténtelo nuevamente.");
      else handleFailure(error, authController.signal);
    } finally {
      busy.current = false;
      if (mounted.current) setAuthenticating(false);
    }
  }

  function disconnect() {
    clearQueue();
    resetSession(null);
  }

  function toggleSound() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
    if (!next) sounds.current?.unlock();
    try { localStorage.setItem(soundKey, next ? "1" : "0"); } catch {}
  }

  function requestSubmit() {
    if (busy.current || deliveryCount === null) return;
    sounds.current?.unlock();
    if (deliveryCount > 1) setConfirm({ kind: "submit", count: deliveryCount });
    else void submit(deliveryCount);
  }

  async function submit(count: number) {
    if (busy.current || !token || !configuration || !controller.current) return;
    const signal = controller.current.signal;
    busy.current = true;
    setIsSubmitting(true);
    setMessage(null);
    setLastCreated(null);
    try {
      if (!attempt.current || attempt.current.count !== count) {
        if (typeof crypto.randomUUID !== "function") {
          throw new DispatchApiError(0, "Este navegador no permite crear una clave de solicitud. Usa un navegador actualizado y una conexión segura.");
        }
        attempt.current = { key: crypto.randomUUID(), count };
      }
      try {
        localStorage.setItem(pendingKey, JSON.stringify(attempt.current));
      } catch { storageFailure(); }
      const data = await dispatchApi("request", restaurant.slug, token, signal, {
        deliveryCount: attempt.current.count,
        idempotencyKey: attempt.current.key,
      });
      if (!mounted.current || signal.aborted) return;
      applySnapshot(data);
      attempt.current = null;
      try { localStorage.removeItem(pendingKey); } catch { storageFailure(); }
      setDeliveryCount(null);
      if (data.request) {
        setLastCreated(formatOrderNumber(requestOrderNumber(data.request)));
        applyServerRequest(data.request, true);
      } else {
        queue.refresh();
      }
    } catch (error: unknown) {
      if (error instanceof DispatchApiError && error.statusCode === 0) {
        if (mounted.current) setMessage(error.message);
      } else {
        handleFailure(error, signal);
      }
    } finally {
      busy.current = false;
      if (mounted.current) {
        setIsSubmitting(false);
        setConfirm(null);
      }
    }
  }

  async function mutate(kind: "cancel" | "resend", request: DispatchRequest) {
    if (busy.current || !token || !controller.current || !isOpenRequest(request.status)) return;
    const signal = controller.current.signal;
    busy.current = true;
    setBusyAction({ kind, requestId: request.requestId });
    setMessage(null);
    try {
      const data = await dispatchApi(kind, restaurant.slug, token, signal, { requestId: request.requestId });
      if (!mounted.current || signal.aborted) return;
      applySnapshot(data);
      const returned = data.request?.requestId === request.requestId ? data.request : null;
      if (kind === "cancel") {
        // The confirmed result gets exactly one message; the generic transition toast is suppressed
        // and its dedup key recorded so later polls cannot repeat it.
        if (returned) applyServerRequest(returned, false, { silent: true });
        else void queue.refresh();
        const cancelled = data.cancelledDeliveries ??
          (returned ? Math.max(0, request.remainingDeliveries - returned.remainingDeliveries) : 0);
        pushToasts([{
          id: `cancel-result-${request.requestId}-${Date.now()}`,
          kind: "cancelled",
          tone: cancelled > 0 ? "success" : "info",
          title: cancellationResultText(cancelled),
        }]);
        // A fully cancelled request moves to the history; reload it once (silently, no toasts).
        queue.refreshHistory();
      } else if (returned) {
        applyServerRequest(returned);
      } else {
        void queue.refresh();
      }
    } catch (error: unknown) {
      handleFailure(error, signal);
    } finally {
      busy.current = false;
      if (mounted.current) {
        setBusyAction(null);
        setConfirm(null);
      }
    }
  }

  const isMutating = isSubmitting || busyAction !== null;
  // The dialog reflects the latest polled counts, not the ones captured when it opened.
  const cancelTarget = confirm?.kind === "cancel"
    ? queue.active.find((item) => item.requestId === confirm.request.requestId) ?? confirm.request
    : null;
  const counts = summarizeDeliveryBoard(queue.active, queue.history.records, nowMs ?? queue.lastUpdated ?? 0);
  const board = partitionActive(queue.active);
  const boardLoaded = queue.lastUpdated !== null;
  const lastUpdateLabel = token && nowMs !== null ? formatLastUpdate(queue.lastUpdated, nowMs) : null;
  const connection: TerminalConnection | null = token
    ? queue.error ? "offline" : queue.syncing || authenticating ? "syncing" : "connected"
    : restoreFailed ? "offline" : null;
  const createDisabledReason = !capabilities.canCreate
    ? "La creación de solicitudes no está disponible en este terminal."
    : configurationIncomplete
      ? "Este terminal todavía no está listo. Contacte a soporte de Recogido."
      : !capabilities.canLoadActive && queue.active.length > 0
        ? "Hay una solicitud en curso. Podrá solicitar otra cuando termine o la cancele."
        : null;

  function actionsFor(request: DispatchRequest): CardActions {
    const busyHere = busyAction?.requestId === request.requestId ? busyAction.kind : null;
    return {
      canResend: canResendRequest(request, capabilities),
      canCancel: canCancelRequest(request, capabilities),
      busyAction: busyHere,
      disabled: isMutating,
      onResend: () => void mutate("resend", request),
      onCancel: () => setConfirm({ kind: "cancel", request }),
    };
  }

  return (
    <div className={styles.terminal}>
      <DispatchHeader
        restaurantName={configuration?.name ?? restaurant.name}
        now={nowMs}
        connection={connection}
        muted={muted}
        onToggleSound={toggleSound}
        onDisconnect={token ? disconnect : undefined}
        disconnectDisabled={isMutating || authenticating}
      />
      <main className={styles.main}>
        {token && queue.error && (
          <ConnectionBanner
            message="El servidor no responde. Se muestran los últimos datos recibidos."
            lastUpdateLabel={lastUpdateLabel}
            retrying={queue.syncing}
            onRetry={queue.refresh}
          />
        )}
        {!token && restoreFailed && (
          <ConnectionBanner
            message="No se pudo conectar el terminal con el servidor."
            retrying={initializing}
            onRetry={() => void restoreDevice()}
          />
        )}
        {configurationIncomplete && (
          <p className={styles.inlineAlert} role="alert">
            Este terminal no está completamente configurado. Contacte a soporte de Recogido.
          </p>
        )}
        {message && <p className={styles.inlineAlert} role="alert">{message}</p>}
        {storageNotice && <p className={styles.inlineNotice} role="status">{storageNotice}</p>}

        {initializing && !token ? (
          <section className={`${styles.card} ${styles.pinCard}`}>
            <p role="status">Verificando terminal…</p>
          </section>
        ) : !token ? (
          !restoreFailed && (
            <section className={`${styles.card} ${styles.pinCard}`} aria-labelledby="pin-title">
              <form onSubmit={authorize}>
                <h1 id="pin-title" className={styles.cardTitle}>Ingrese el PIN de este terminal</h1>
                <p className={styles.instruction}>Ingrese el PIN del restaurante para activar el terminal de despacho.</p>
                <label className={styles.pinLabel} htmlFor="device-pin">PIN del terminal</label>
                <input
                  id="device-pin"
                  className={styles.pinInput}
                  type="password"
                  autoComplete="off"
                  minLength={4}
                  maxLength={128}
                  required
                  value={pin}
                  disabled={authenticating}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="Ingrese el PIN"
                />
                <button type="submit" className={styles.primaryButton} disabled={authenticating || !pin.trim()}>
                  {authenticating && <span className={styles.spinner} aria-hidden="true" />}
                  {authenticating ? "VALIDANDO…" : "CONECTAR TERMINAL"}
                </button>
                <p className={styles.hint}>Use solo un dispositivo de confianza. El PIN se guarda en este dispositivo tras validarlo.</p>
              </form>
            </section>
          )
        ) : (
          <div className={styles.layout}>
            <div className={styles.column}>
              {configuration ? (
                <NewDeliveryRequest
                  maxDeliveries={configuration.maxDeliveries}
                  assignmentMode={configuration.assignmentMode}
                  selected={deliveryCount}
                  submitting={isSubmitting}
                  disabledReason={createDisabledReason}
                  lastCreatedLabel={lastCreated}
                  onSelect={(count) => { sounds.current?.unlock(); setDeliveryCount(count); setLastCreated(null); }}
                  onSubmit={requestSubmit}
                />
              ) : (
                <section className={styles.card}><p role="status">Cargando configuración del restaurante…</p></section>
              )}
              {operationStatus === "created_with_timer_error" && (
                <p className={styles.inlineNotice} role="status">
                  La solicitud se creó, pero el aviso automático de 20 segundos podría no activarse. Vigile la solicitud en la cola.
                </p>
              )}
              <DispatchSummary counts={counts} />
            </div>
            <div className={styles.column}>
              <ActiveDeliveriesSection
                id="searching"
                title="Buscando conductor"
                emptyText="No hay solicitudes buscando conductor."
                loadingText="Cargando solicitudes activas…"
                requests={board.searching}
                finished={capabilities.canLoadHistory ? [] : queue.finished}
                nowMs={nowMs}
                hasLoaded={boardLoaded}
                restaurantName={configuration?.name ?? restaurant.name}
                unavailable={queue.error !== null}
                lastUpdateLabel={lastUpdateLabel}
                actionsFor={actionsFor}
                onDismissFinished={queue.dismissFinished}
              />
              <ActiveDeliveriesSection
                id="in-progress"
                title="Entregas en curso"
                emptyText="No hay entregas en curso."
                loadingText="Cargando entregas en curso…"
                requests={board.inProgress}
                nowMs={nowMs}
                hasLoaded={boardLoaded}
                restaurantName={configuration?.name ?? restaurant.name}
              />
            </div>
            <div className={styles.fullRow}>
              <DeliveryHistorySection
                records={queue.history.records}
                available={capabilities.canLoadHistory}
                loaded={queue.history.loaded}
                loading={queue.history.loading}
                error={queue.history.error}
                onRefresh={queue.refreshHistory}
              />
            </div>
          </div>
        )}
        {mockMode && <p className={styles.footerNote}>Modo de prueba · No se envían avisos reales a conductores</p>}
      </main>
      <NotificationCenter notifications={toasts} onDismiss={dismissToast} />
      <ConfirmActionDialog
        open={confirm?.kind === "submit"}
        title={`¿Solicitar ${confirm?.kind === "submit" ? confirm.count : ""} entregas?`}
        description="Se avisará a los conductores disponibles para cada entrega."
        confirmLabel="SÍ, SOLICITAR"
        busy={isSubmitting}
        onConfirm={() => { if (confirm?.kind === "submit") void submit(confirm.count); }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmActionDialog
        open={cancelTarget !== null}
        title={`¿Cancelar entregas pendientes de la solicitud ${cancelTarget ? formatOrderNumber(requestOrderNumber(cancelTarget)) : ""}?`}
        description={cancelTarget ? cancelConfirmationText(cancelTarget) : ""}
        confirmLabel={busyAction?.kind === "cancel" ? "Cancelando…" : "CANCELAR PENDIENTES"}
        cancelLabel="VOLVER"
        tone="danger"
        busy={busyAction?.kind === "cancel"}
        onConfirm={() => { if (cancelTarget) void mutate("cancel", cancelTarget); }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
