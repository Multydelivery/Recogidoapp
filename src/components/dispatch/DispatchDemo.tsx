"use client";

import { useEffect, useRef, useState } from "react";
import { DispatchIcon, RestaurantIcon } from "@/components/icons";
import { formatDemoTime, type DemoRequest, type DemoStatus } from "@/lib/dispatch/demo-types";
import { DeliveryKeypad } from "./DeliveryKeypad";
import { DeliveryStatus } from "./DeliveryStatus";
import { DeliveryHistory } from "./DeliveryHistory";
import styles from "./DispatchDemo.module.css";

export function DispatchDemo() {
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [request, setRequest] = useState<DemoRequest | null>(null);
  const [history, setHistory] = useState<DemoRequest[]>([]);
  const [now, setNow] = useState<string | null>(null);
  const [soundNotice, setSoundNotice] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const requestRef = useRef<DemoRequest | null>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assignmentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const mounted = useRef(false);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const keypadContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    const clock = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(clock);
      if (submitTimer.current !== null) clearTimeout(submitTimer.current);
      if (assignmentTimer.current !== null) clearTimeout(assignmentTimer.current);
      const context = audioContext.current;
      audioContext.current = null;
      if (context && context.state !== "closed") {
        void context.close().catch((error: unknown) => console.warn("No se pudo cerrar el audio del demo.", error));
      }
    };
  }, []);

  useEffect(() => {
    if (status === "searching" || status === "assigned" || status === "cancelled") {
      statusHeading.current?.focus();
    } else if (status === "idle") {
      keypadContainer.current?.querySelector("button")?.focus();
    }
  }, [status]);

  function reportAudioFailure(error: unknown) {
    console.warn("La confirmación sonora del demo no está disponible.", error);
    if (mounted.current) setSoundNotice("Sonido no disponible. La confirmación visual sigue activa.");
  }

  function prepareAudio() {
    if (typeof window.AudioContext !== "function") {
      setSoundNotice("Este navegador no permite sonido. La confirmación será visual.");
      return;
    }
    try {
      audioContext.current ??= new AudioContext();
      if (audioContext.current.state === "suspended") {
        void audioContext.current.resume().catch(reportAudioFailure);
      }
    } catch (error: unknown) {
      reportAudioFailure(error);
    }
  }

  function playConfirmation() {
    const context = audioContext.current;
    if (!context || context.state !== "running") {
      setSoundNotice("Sonido no disponible. Conductor asignado confirmado en pantalla.");
      return;
    }
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, start);
      oscillator.frequency.setValueAtTime(880, start + 0.12);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + 0.32);
    } catch (error: unknown) {
      reportAudioFailure(error);
    }
  }

  function updateRequest(next: DemoRequest) {
    requestRef.current = next;
    setRequest(next);
    setStatus(next.status);
    setHistory((previous) => previous.map((item) => item.requestId === next.requestId ? next : item));
  }

  function submitRequest() {
    // The ref blocks a second event before React commits the disabled button.
    if (submissionLock.current || status !== "idle" || deliveryCount === null) return;
    submissionLock.current = true;
    setIsSubmitting(true);
    setStatus("submitting");
    setSoundNotice(null);
    prepareAudio();
    submitTimer.current = setTimeout(() => {
      submitTimer.current = null;
      const createdAt = new Date();
      const next: DemoRequest = {
        requestId: `DEMO_${createdAt.getTime()}`,
        deliveryCount,
        status: "searching",
        createdAt: createdAt.toISOString(),
      };
      requestRef.current = next;
      setRequest(next);
      setHistory((previous) => [next, ...previous].slice(0, 5));
      setStatus("searching");
      setIsSubmitting(false);
      assignmentTimer.current = setTimeout(() => {
        assignmentTimer.current = null;
        if (requestRef.current?.requestId !== next.requestId || requestRef.current.status !== "searching") return;
        updateRequest({ ...next, status: "assigned", driverName: "Conductor Demo" });
        playConfirmation();
      }, 5000);
    }, 800);
  }

  function cancelRequest() {
    const current = requestRef.current;
    if (current?.status !== "searching") return;
    if (!window.confirm(`¿Cancelar la solicitud de ${current.deliveryCount} ${current.deliveryCount === 1 ? "entrega" : "entregas"}?`)) return;
    if (requestRef.current?.status !== "searching") return;
    if (assignmentTimer.current !== null) {
      clearTimeout(assignmentTimer.current);
      assignmentTimer.current = null;
    }
    updateRequest({ ...current, status: "cancelled" });
  }

  function newRequest() {
    if (status !== "assigned" && status !== "cancelled") return;
    submissionLock.current = false;
    requestRef.current = null;
    setRequest(null);
    setDeliveryCount(null);
    setShowMore(false);
    setSoundNotice(null);
    setStatus("idle");
  }

  const todayHistory = history.filter((item) =>
    now === null || new Date(item.createdAt).toDateString() === new Date(now).toDateString()
  );
  const announcement = status === "submitting"
    ? "Enviando solicitud. Espera un momento."
    : status === "searching"
      ? `Solicitud enviada. ${request?.deliveryCount} ${request?.deliveryCount === 1 ? "entrega" : "entregas"}. Buscando conductor.`
      : status === "assigned"
        ? `Conductor asignado: Conductor Demo. Solicitud ${request?.requestId}.`
        : status === "cancelled"
          ? "Solicitud cancelada. Puedes crear una nueva solicitud."
          : "Selecciona la cantidad de entregas.";

  return (
    <div lang="es" className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}><DispatchIcon aria-hidden="true" /></span>
            <div><strong>RECOGIDO</strong><span>DISPATCH</span></div>
          </div>
          <div className={styles.restaurant}><RestaurantIcon aria-hidden="true" /><div><span>Restaurante</span><strong>La Fonda Demo</strong></div></div>
          <div className={styles.connection}>
            <span><i aria-hidden="true" /> En línea</span>
            <time dateTime={now ?? undefined} aria-label="Hora actual">{now ? formatDemoTime(now) : "--:--"}</time>
          </div>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.workspaceHeading}>
          <p>Panel de restaurante <span>/ Despacho de entregas</span></p>
          <span className={styles.demoBadge}>MODO DEMO</span>
        </div>
        <div className={styles.workspace}>
          <section className={styles.orderCard} aria-label="Solicitud de entregas">
            <div className={styles.cardContent}>
              {request ? (
                <DeliveryStatus request={request} headingRef={statusHeading} />
              ) : (
                <div ref={keypadContainer}>
                  <DeliveryKeypad
                    deliveryCount={deliveryCount}
                    showMore={showMore}
                    isSubmitting={isSubmitting}
                    onSelect={setDeliveryCount}
                    onShowMore={() => setShowMore(true)}
                    onSubmit={submitRequest}
                  />
                </div>
              )}
              {(status === "assigned" || status === "cancelled") && (
                <button type="button" className={styles.sendButton} onClick={newRequest}>NUEVA SOLICITUD</button>
              )}
              <button type="button" className={styles.cancelButton} disabled={status !== "searching"} onClick={cancelRequest}>
                CANCELAR ÚLTIMA
              </button>
              <p className={styles.cancelHint}>{status === "assigned" ? "Una solicitud asignada ya no se puede cancelar." : "Solo puedes cancelar mientras se busca un conductor."}</p>
              {soundNotice && <p className={styles.soundNotice} role="status">{soundNotice}</p>}
            </div>
            <div className={styles.cardFooter}><span aria-hidden="true">✓</span> Solicitudes simuladas · Sin envíos reales</div>
          </section>
          <DeliveryHistory requests={todayHistory} />
        </div>
        <footer className={styles.footer}>
          <span>RECOGIDO DISPATCH <span>· Terminal de restaurante</span></span>
          <span>Demo local. Sin Twilio, Make ni APIs externas.</span>
        </footer>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      </main>
    </div>
  );
}
