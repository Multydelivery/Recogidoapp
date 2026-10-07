"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { DispatchApiError, dispatchApi } from "@/lib/dispatch/client";
import { dispatchStatusLabels, isOpenRequest, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "@/lib/dispatch/dispatch-types";
import { DispatchFrame } from "./DispatchFrame";
import { DeliveryKeypad } from "./DeliveryKeypad";
import { DeliveryStatus } from "./DeliveryStatus";
import { DeliveryHistory } from "./DeliveryHistory";
import styles from "./DispatchDemo.module.css";

export function DispatchTerminal({ restaurant, initialMockMode = true }: {
  restaurant: RestaurantPublic;
  initialMockMode?: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const [history, setHistory] = useState<DispatchRequest[]>([]);
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [connected, setConnected] = useState(false);
  const [mockMode, setMockMode] = useState(initialMockMode);
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
  const heading = useRef<HTMLHeadingElement>(null);
  const keypad = useRef<HTMLDivElement>(null);
  const storageKey = `recogido.dispatch.device.${restaurant.slug}`;

  const applySnapshot = useCallback((data: DispatchSnapshot) => {
    setMockMode(data.mockMode);
    setConnectionFailed(false);
    setHistory((previous) => data.mockMode ? data.history :
      [...data.history, ...previous.filter((item) => !data.history.some((next) => next.requestId === item.requestId))]
        .filter((item) => new Date(item.createdAt).toDateString() === new Date().toDateString()).slice(0, 5));
    if (data.request?.requestId !== dismissedId.current || (data.request && isOpenRequest(data.request.status))) {
      setRequest(data.request);
    }
    setConnected(true);
  }, []);

  const storageFailure = useCallback(() => {
    setStorageNotice("El navegador no permite guardar el PIN. Tendrás que ingresarlo de nuevo al recargar.");
  }, []);

  const handleFailure = useCallback((error: unknown) => {
    if (!mounted.current || controller.current?.signal.aborted) return;
    setConnected(false);
    setConnectionFailed(true);
    setMessage(error instanceof DispatchApiError ? error.message : "No se pudo contactar o verificar el servidor. Reintenta; no se confirmó la operación.");
    if (error instanceof DispatchApiError && error.statusCode === 401) {
      setToken(null);
      try { localStorage.removeItem(storageKey); } catch { storageFailure(); }
    }
  }, [storageKey, storageFailure]);

  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    controller.current = abort;
    const clock = setInterval(() => setNow(new Date().toISOString()), 1000);
    async function restoreDevice() {
      let saved: string | null = null;
      try { saved = localStorage.getItem(storageKey); } catch { storageFailure(); }
      if (saved) {
        try {
          const data = await dispatchApi("status", restaurant.slug, saved, abort.signal);
          if (!abort.signal.aborted) {
            applySnapshot(data);
            setToken(saved);
          }
        } catch (error: unknown) {
          if (!abort.signal.aborted) handleFailure(error);
        }
      }
      if (!abort.signal.aborted) setInitializing(false);
    }
    void restoreDevice();
    return () => {
      mounted.current = false;
      abort.abort();
      clearInterval(clock);
    };
  }, [restaurant.slug, storageKey, applySnapshot, storageFailure, handleFailure]);

  useEffect(() => {
    if (!token) return;
    const pollController = new AbortController();
    async function poll() {
      if (busy.current || pollBusy.current || !token) return;
      pollBusy.current = true;
      const pollRevision = revision.current;
      try {
        const data = await dispatchApi("status", restaurant.slug, token, pollController.signal);
        if (!pollController.signal.aborted && pollRevision === revision.current) {
          applySnapshot(data);
          setMessage(null);
        }
      } catch (error: unknown) {
        if (!pollController.signal.aborted && pollRevision === revision.current) handleFailure(error);
      } finally {
        pollBusy.current = false;
      }
    }
    const interval = setInterval(() => void poll(), 5000);
    return () => { clearInterval(interval); pollController.abort(); };
  }, [token, restaurant.slug, applySnapshot, handleFailure]);

  const requestStatus = request?.status;
  useEffect(() => {
    if (requestStatus) heading.current?.focus();
    else if (token) keypad.current?.querySelector("button")?.focus();
  }, [requestStatus, token]);

  async function authorize(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !controller.current || !pin.trim()) return;
    busy.current = true;
    setAuthenticating(true);
    setMessage(null);
    const candidate = pin.trim();
    try {
      const data = await dispatchApi("status", restaurant.slug, candidate, controller.current.signal);
      if (!mounted.current) return;
      applySnapshot(data);
      setToken(candidate);
      setPin("");
      try { localStorage.setItem(storageKey, candidate); } catch { storageFailure(); }
    } catch (error: unknown) {
      handleFailure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setAuthenticating(false);
    }
  }

  async function submit() {
    if (busy.current || !token || deliveryCount === null || request || !controller.current) return;
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
      const data = await dispatchApi("request", restaurant.slug, token, controller.current.signal, {
        deliveryCount: attempt.current.count,
        idempotencyKey: attempt.current.key,
      });
      if (!mounted.current) return;
      applySnapshot(data);
      attempt.current = null;
    } catch (error: unknown) {
      handleFailure(error);
    } finally {
      busy.current = false;
      if (mounted.current) setIsSubmitting(false);
    }
  }

  async function cancel() {
    if (busy.current || !token || !request || !isOpenRequest(request.status) || !controller.current) return;
    if (!window.confirm(`¿Cancelar la solicitud de ${request.deliveryCount} entregas?`)) return;
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

  function reset() {
    if (!request || isOpenRequest(request.status)) return;
    revision.current++;
    dismissedId.current = request.requestId;
    setRequest(null);
    setDeliveryCount(null);
    setShowMore(false);
    setMessage(null);
    attempt.current = null;
  }

  return (
    <DispatchFrame restaurantName={restaurant.name} now={now} connected={connected} mockMode={mockMode} connectionFailed={connectionFailed}>
      <div className={styles.workspace}>
        <section className={styles.orderCard} aria-label="Solicitud de entregas">
          <div className={styles.cardContent}>
            {initializing ? <p role="status">Verificando dispositivo…</p> : !token ? (
              <form onSubmit={authorize}>
                <p className={styles.eyebrow}>ACTIVAR DISPOSITIVO</p>
                <h1 className={styles.title}>Token o PIN del dispositivo</h1>
                <p className={styles.subtitle}>Ingresa la clave de este restaurante. Se validará con el servidor.</p>
                <label className={styles.pinLabel} htmlFor="device-pin">Token o PIN</label>
                <input id="device-pin" className={styles.pinInput} type="password" autoComplete="off" minLength={6} maxLength={128} required value={pin} disabled={authenticating} onChange={(event) => setPin(event.target.value)} />
                <button type="submit" className={styles.sendButton} disabled={authenticating || !pin.trim()}>
                  {authenticating ? "VALIDANDO…" : "VALIDAR DISPOSITIVO"}
                </button>
                <p className={styles.cancelHint}>Solo en un dispositivo de confianza. El PIN se guarda localmente tras validarlo.</p>
              </form>
            ) : (
              <>
                {request ? (
                  <DeliveryStatus headingRef={heading} stage={request.status} request={{
                    ...request,
                    status: request.status === "claimed" ? "assigned" : request.status === "cancelled" ? "cancelled" : request.status === "error" ? "error" : "searching",
                  }} />
                ) : (
                  <div ref={keypad}>
                    <DeliveryKeypad deliveryCount={deliveryCount} showMore={showMore} isSubmitting={isSubmitting}
                      onSelect={setDeliveryCount} onShowMore={() => setShowMore(true)} onSubmit={() => void submit()} />
                  </div>
                )}
                {request && !isOpenRequest(request.status) && (
                  <button className={styles.sendButton} type="button" onClick={reset}>NUEVA SOLICITUD</button>
                )}
                <button className={styles.cancelButton} type="button" disabled={!request || !isOpenRequest(request.status) || isCancelling || isSubmitting} onClick={() => void cancel()}>
                  {isCancelling ? "CANCELANDO…" : "CANCELAR ÚLTIMA"}
                </button>
                <p className={styles.cancelHint}>Solo se puede cancelar antes de asignar conductor. Estado consultado cada 5 segundos.</p>
              </>
            )}
            {message && <p className={styles.errorNotice} role="alert">{message}</p>}
            {storageNotice && <p className={styles.soundNotice} role="status">{storageNotice}</p>}
          </div>
          <div className={styles.cardFooter}>{mockMode ? "Simulador del servidor · Sin envíos reales" : "Estado confirmado por el servicio central"}</div>
        </section>
        <DeliveryHistory requests={token ? history : []} serverBacked mockMode={mockMode} />
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {request ? `${dispatchStatusLabels[request.status]}. Solicitud ${request.requestId}.` : "Selecciona la cantidad de entregas."}
      </p>
    </DispatchFrame>
  );
}
