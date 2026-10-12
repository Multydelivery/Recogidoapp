"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DispatchApiError, dispatchApi } from "@/lib/dispatch/client";
import {
  dispatchStatusLabels,
  isOpenRequest,
  type DispatchRequest,
  type DispatchCapabilities,
  type DispatchSnapshot,
  type RestaurantPublic,
} from "@/lib/dispatch/dispatch-types";
import { DispatchFrame } from "./DispatchFrame";
import { DeliveryKeypad } from "./DeliveryKeypad";
import { DeliveryStatus } from "./DeliveryStatus";
import { DeliveryHistory } from "./DeliveryHistory";
import styles from "./DispatchDemo.module.css";

const mockCapabilities: DispatchCapabilities = {
  liveDispatch: false,
  canCreate: true,
  canReadStatus: true,
  canCancel: true,
  canResend: true,
  canLoadHistory: true,
};

function isAuthError(error: unknown): boolean {
  if (error instanceof DispatchApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) return true;
    if (typeof error.message === "string" && error.message.includes("Token o PIN inválido")) return true;
  }
  return false;
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
  const [configuration, setConfiguration] = useState<RestaurantPublic | null>(null);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const [operationStatus, setOperationStatus] = useState<DispatchSnapshot["operationStatus"]>();
  const [history, setHistory] = useState<DispatchRequest[]>([]);
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mockMode, setMockMode] = useState(initialMockMode);
  const [configurationIncomplete, setConfigurationIncomplete] = useState(initialConfigurationIncomplete);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [now, setNow] = useState<string | null>(null);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const pollBusy = useRef(false);
  const attempt = useRef<{ key: string; count: number } | null>(null);
  const dismissedId = useRef<string | null>(null);
  const revision = useRef(0);
  const pollDelay = useRef(3000);
  const heading = useRef<HTMLHeadingElement>(null);
  const keypad = useRef<HTMLDivElement>(null);
  const storageKey = `recogido:device-token:${restaurant.slug}`;
  const legacyStorageKey = `recogido.dispatch.device.${restaurant.slug}`;
  const capabilities = initialCapabilities;

  const storageFailure = useCallback(() => {
    setStorageNotice("El navegador no permite guardar el PIN. Tendrás que ingresarlo de nuevo al recargar.");
  }, []);

  const getSavedPin = useCallback((): string | null => {
    try {
      const val = localStorage.getItem(storageKey) ?? localStorage.getItem(legacyStorageKey);
      return val && val.trim().length > 0 ? val.trim() : null;
    } catch {
      storageFailure();
      return null;
    }
  }, [storageKey, legacyStorageKey, storageFailure]);

  const savePin = useCallback((pinValue: string) => {
    try {
      localStorage.setItem(storageKey, pinValue);
      try { localStorage.removeItem(legacyStorageKey); } catch {}
    } catch {
      storageFailure();
    }
  }, [storageKey, legacyStorageKey, storageFailure]);

  const removeSavedPin = useCallback(() => {
    try {
      localStorage.removeItem(storageKey);
      localStorage.removeItem(legacyStorageKey);
    } catch {
      storageFailure();
    }
  }, [storageKey, legacyStorageKey, storageFailure]);

  const applySnapshot = useCallback((data: DispatchSnapshot) => {
    setMockMode(data.mockMode);
    setConfigurationIncomplete(initialConfigurationIncomplete);
    setConfiguration(data.restaurant);
    setOperationStatus(data.operationStatus);
    setConnectionFailed(false);
    setHistory((previous) => !capabilities.canLoadHistory ? [] : data.mockMode ? data.history :
      [...data.history, ...previous.filter((item) => !data.history.some((next) => next.requestId === item.requestId))]
        .slice(0, 5));
    if (data.request?.requestId !== dismissedId.current || (data.request && isOpenRequest(data.request.status))) {
      setRequest(data.request);
    }
    setConnected(true);
  }, [capabilities.canLoadHistory, initialConfigurationIncomplete]);

  const handleFailure = useCallback((error: unknown) => {
    if (!mounted.current || controller.current?.signal.aborted) return;
    if (isAuthError(error)) {
      setToken(null);
      setConfiguration(null);
      setConnected(false);
      setConnectionFailed(false);
      setMessage("PIN incorrecto. Inténtelo nuevamente.");
      removeSavedPin();
      return;
    }
    setConnected(false);
    setConnectionFailed(true);
    setConfigurationIncomplete(error instanceof DispatchApiError && error.code === "NOT_CONFIGURED");
    setMessage(`Error de conexión: ${error instanceof DispatchApiError ? error.message : "No se pudo contactar o verificar el servidor. Reintenta; no se confirmó la operación."}`);
  }, [removeSavedPin]);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const clock = setInterval(() => setNow(new Date().toISOString()), 1000);
    async function restoreDevice() {
      const saved = getSavedPin();
      if (!saved) {
        if (mounted.current) setInitializing(false);
        return;
      }
      try {
        const savedAttempt = localStorage.getItem(`${storageKey}.pending`);
        if (savedAttempt) {
          const parsed: unknown = JSON.parse(savedAttempt);
          if (parsed && typeof parsed === "object" && "key" in parsed && typeof parsed.key === "string" &&
            /^[A-Za-z0-9_-]{8,128}$/.test(parsed.key) && "count" in parsed && typeof parsed.count === "number" &&
            Number.isInteger(parsed.count) && parsed.count >= 1 && parsed.count <= 20) {
            attempt.current = { key: parsed.key, count: parsed.count };
          }
        }
      } catch { storageFailure(); }
      try {
        const configured = await dispatchApi("config", restaurant.slug, saved, abort.signal);
        const recent = capabilities.canLoadHistory
          ? await dispatchApi("recent", restaurant.slug, saved, abort.signal)
          : null;
        const data = capabilities.canReadStatus
          ? await dispatchApi("status", restaurant.slug, saved, abort.signal)
          : configured;
        if (!abort.signal.aborted && mounted.current) {
          applySnapshot({ ...data, history: recent?.history ?? [] });
          setToken(saved);
          setMessage(null);
        }
      } catch (error: unknown) {
        if (!abort.signal.aborted && mounted.current) {
          if (isAuthError(error)) {
            removeSavedPin();
            setToken(null);
            setConfiguration(null);
            setConnected(false);
            setConnectionFailed(false);
            setMessage("PIN incorrecto. Inténtelo nuevamente.");
          } else {
            handleFailure(error);
          }
        }
      } finally {
        if (mounted.current) {
          setInitializing(false);
        }
      }
    }
    void restoreDevice();
    return () => {
      mounted.current = false;
      abort.abort();
      clearInterval(clock);
    };
  }, [restaurant.slug, storageKey, applySnapshot, storageFailure, handleFailure, getSavedPin, removeSavedPin, capabilities.canLoadHistory, capabilities.canReadStatus]);

  useEffect(() => {
    const activeRequest = request;
    if (!token || !activeRequest || !isOpenRequest(activeRequest.status)) return;
    const activeRequestId = activeRequest.requestId;
    const activeRequestStatus = activeRequest.status;
    const pollController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    async function poll() {
      if (disposed || document.visibilityState === "hidden" || !token) return;
      if (busy.current || pollBusy.current) {
        timeout = setTimeout(() => void poll(), 1000);
        return;
      }
      pollBusy.current = true;
      const pollRevision = revision.current;
      try {
        const data = await dispatchApi("status", restaurant.slug, token, pollController.signal, { requestId: activeRequestId });
        if (!pollController.signal.aborted && pollRevision === revision.current) {
          applySnapshot(data);
          setMessage(null);
          pollDelay.current = 3000;
        }
      } catch (error: unknown) {
        if (!pollController.signal.aborted && pollRevision === revision.current) {
          handleFailure(error);
          pollDelay.current = Math.min(pollDelay.current * 2, 30_000);
        }
      } finally {
        pollBusy.current = false;
        if (!disposed && isOpenRequest(activeRequestStatus)) timeout = setTimeout(() => void poll(), pollDelay.current);
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible" && !pollBusy.current) {
        if (timeout) clearTimeout(timeout);
        void poll();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    timeout = setTimeout(() => void poll(), mockMode ? 5000 : 3000);
    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      pollController.abort();
    };
  }, [token, request, mockMode, restaurant.slug, applySnapshot, handleFailure]);

  const requestStatus = request?.status;
  useEffect(() => {
    if (requestStatus) heading.current?.focus();
    else if (token) keypad.current?.querySelector("button")?.focus();
  }, [requestStatus, token]);

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authenticating || busy.current || !pin.trim()) return;
    busy.current = true;
    setAuthenticating(true);
    setMessage(null);
    const candidate = pin.trim();
    const authController = new AbortController();
    controller.current = authController;
    try {
      const configured = await dispatchApi("config", restaurant.slug, candidate, authController.signal);
      const recent = capabilities.canLoadHistory
        ? await dispatchApi("recent", restaurant.slug, candidate, authController.signal)
        : null;
      const data = capabilities.canReadStatus
        ? await dispatchApi("status", restaurant.slug, candidate, authController.signal)
        : configured;
      if (!mounted.current || authController.signal.aborted) return;
      applySnapshot({ ...data, history: recent?.history ?? [] });
      setToken(candidate);
      setPin("");
      setMessage(null);
      savePin(candidate);
    } catch (error: unknown) {
      if (!mounted.current || authController.signal.aborted) return;
      if (isAuthError(error)) {
        removeSavedPin();
        setToken(null);
        setConfiguration(null);
        setConnected(false);
        setConnectionFailed(false);
        setMessage("PIN incorrecto. Inténtelo nuevamente.");
      } else {
        handleFailure(error);
      }
    } finally {
      busy.current = false;
      if (mounted.current) setAuthenticating(false);
    }
  }

  function disconnect() {
    if (controller.current) {
      controller.current.abort();
      controller.current = new AbortController();
    }
    removeSavedPin();
    setToken(null);
    setPin("");
    setConnected(false);
    setConnectionFailed(false);
    setConfiguration(null);
    setRequest(null);
    setDeliveryCount(null);
    setMessage(null);
    setInitializing(false);
  }

  async function submit() {
    if (busy.current || !token || !configuration || deliveryCount === null || request || !controller.current) return;
    revision.current++;
    busy.current = true;
    setIsSubmitting(true);
    setMessage(null);
    try {
      if (!attempt.current || attempt.current.count !== deliveryCount) {
        if (typeof crypto.randomUUID !== "function") {
          throw new DispatchApiError(0, "Este navegador no permite crear una clave de solicitud. Usa un navegador actualizado y una conexión segura.");
        }
        attempt.current = { key: crypto.randomUUID(), count: deliveryCount };
      }
      try {
        localStorage.setItem(`${storageKey}.pending`, JSON.stringify(attempt.current));
      } catch { storageFailure(); }
      const data = await dispatchApi("request", restaurant.slug, token, controller.current.signal, {
        deliveryCount: attempt.current.count,
        idempotencyKey: attempt.current.key,
      });
      if (!mounted.current) return;
      applySnapshot(data);
      attempt.current = null;
      try { localStorage.removeItem(`${storageKey}.pending`); } catch { storageFailure(); }
    } catch (error: unknown) {
      handleFailure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  }

  async function cancel() {
    if (busy.current || !token || !request || !isOpenRequest(request.status) || !controller.current) return;
    if (!window.confirm(`¿Cancelar las ${request.remainingDeliveries} entregas que siguen abiertas? Las ya asignadas se conservarán.`)) return;
    revision.current++;
    busy.current = true;
    setIsCancelling(true);
    setMessage(null);
    try {
      const data = await dispatchApi("cancel", restaurant.slug, token, controller.current.signal, { requestId: request.requestId });
      if (mounted.current) applySnapshot(data);
    } catch (error: unknown) {
      handleFailure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setIsCancelling(false);
    }
  }

  async function resend() {
    if (busy.current || !token || !request || !isOpenRequest(request.status) || request.remainingDeliveries === 0 || !controller.current) return;
    revision.current++;
    busy.current = true;
    setIsResending(true);
    setMessage(null);
    try {
      const data = await dispatchApi("resend", restaurant.slug, token, controller.current.signal, { requestId: request.requestId });
      if (mounted.current) applySnapshot(data);
    } catch (error: unknown) {
      handleFailure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setIsResending(false);
    }
  }

  function reset() {
    if (!request || isOpenRequest(request.status)) return;
    revision.current++;
    dismissedId.current = request.requestId;
    setRequest(null);
    setDeliveryCount(null);
    setMessage(null);
    attempt.current = null;
  }

  const canManageOpenDeliveries = !!request && isOpenRequest(request.status) && request.remainingDeliveries > 0;
  const isMutating = isSubmitting || isCancelling || isResending;
  return (
    <DispatchFrame
      restaurantName={configuration?.name ?? restaurant.name}
      now={now}
      connected={connected}
      mockMode={mockMode}
      connectionFailed={connectionFailed}
      configurationIncomplete={configurationIncomplete}
    >
      <div className={styles.workspace}>
        <section className={styles.orderCard} aria-label="Solicitud de entregas">
          <div className={styles.cardContent}>
            {initializing ? <p role="status">Verificando dispositivo…</p> : !token ? (
              <form onSubmit={authorize}>
                <p className={styles.eyebrow}>ACTIVAR TERMINAL</p>
                <h1 className={styles.title}>Ingrese el PIN de este terminal</h1>
                <p className={styles.subtitle}>Ingresa el PIN de este restaurante para activar y conectar el terminal.</p>
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
                  placeholder="Ingresa el PIN"
                />
                <button type="submit" className={styles.sendButton} disabled={authenticating || !pin.trim()}>
                  {authenticating ? "VALIDANDO…" : "CONECTAR TERMINAL"}
                </button>
                <p className={styles.cancelHint}>Solo en un dispositivo de confianza. El PIN se guarda localmente tras validarlo.</p>
              </form>
            ) : request ? (
              <DeliveryStatus request={request} headingRef={heading} now={now} />
            ) : configuration ? (
              <div ref={keypad}>
                <DeliveryKeypad
                  deliveryCount={deliveryCount}
                  maxDeliveries={configuration.maxDeliveries}
                  maxActiveDeliveriesPerDriver={configuration.maxActiveDeliveriesPerDriver}
                  assignmentMode={configuration.assignmentMode}
                  isSubmitting={isSubmitting}
                  isDisabled={!capabilities.canCreate}
                  onSelect={setDeliveryCount}
                  onSubmit={() => void submit()}
                />
              </div>
            ) : (
              <p role="status">Cargando configuración del restaurante…</p>
            )}
            {configurationIncomplete && (
              <p className={styles.errorNotice} role="alert">
                Configuración incompleta: la prueba requiere configuración, creación, estado, autenticación y temporizador de Make.
              </p>
            )}
            {request && !isOpenRequest(request.status) && (
              <button className={styles.sendButton} type="button" onClick={reset}>NUEVA SOLICITUD</button>
            )}
            {request && canManageOpenDeliveries && (
              <>
                <button className={styles.sendButton} type="button" disabled={isMutating || !capabilities.canResend} aria-disabled={!capabilities.canResend} onClick={() => void resend()}>
                  {isResending ? "REOFERTANDO…" : "VOLVER A OFRECER PENDIENTES"}
                </button>
                <button className={styles.cancelButton} type="button" disabled={isMutating || !capabilities.canCancel} aria-disabled={!capabilities.canCancel} onClick={() => void cancel()}>
                  {isCancelling ? "CANCELANDO…" : "CANCELAR ENTREGAS PENDIENTES"}
                </button>
                {!capabilities.canResend && <p className={styles.cancelHint} role="status">Reoferta desde la web estará disponible próximamente.</p>}
                {!capabilities.canCancel && <p className={styles.cancelHint} role="status">Cancelación desde la web estará disponible próximamente.</p>}
              </>
            )}
            {token && (
              <button
                type="button"
                className={styles.disconnectButton}
                disabled={isMutating || authenticating}
                onClick={disconnect}
                aria-label="Desconectar terminal"
              >
                Desconectar terminal
              </button>
            )}
            {request && <p className={styles.cancelHint}>Las operaciones se aplican solo a las entregas abiertas. Estado actualizado cada 5 segundos.</p>}
            {message && <p className={styles.errorNotice} role="alert">{message}</p>}
            {operationStatus === "created_with_timer_error" && (
              <p className={styles.errorNotice} role="alert">
                La solicitud se creó en Twilio, pero no se confirmó el temporizador de alertas. La solicitud {request?.requestId} ya puede consultarse.
              </p>
            )}
            {storageNotice && <p className={styles.soundNotice} role="status">{storageNotice}</p>}
          </div>
          <div className={styles.cardFooter}>{mockMode ? "Simulador del servidor · Sin envíos reales" : "Estado confirmado por el servicio central"}</div>
        </section>
        {capabilities.canLoadHistory
          ? <DeliveryHistory requests={token ? history : []} serverBacked mockMode={mockMode} />
          : <aside className={styles.history} aria-label="Historial de solicitudes">
              <p className={styles.cancelHint} role="status">Historial real estará disponible próximamente.</p>
            </aside>}
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {request ? `${dispatchStatusLabels[request.status]}. Solicitud ${request.requestId}.` : "Selecciona la cantidad de entregas."}
      </p>
    </DispatchFrame>
  );
}
