"use client";

import { useEffect, useRef, useState } from "react";
import type { DispatchRequest, RestaurantPublic } from "@/lib/dispatch/dispatch-types";
import { isOpenRequest } from "@/lib/dispatch/dispatch-types";
import { DispatchFrame } from "./DispatchFrame";
import { DeliveryKeypad } from "./DeliveryKeypad";
import { DeliveryStatus } from "./DeliveryStatus";
import { DeliveryHistory } from "./DeliveryHistory";
import styles from "./DispatchDemo.module.css";

const scenarios: RestaurantPublic[] = [
  {
    slug: "la-fonda-demo",
    name: "La Fonda Demo",
    active: true,
    deliveryEnabled: true,
    maxDeliveries: 3,
    assignmentMode: "individual",
    maxActiveDeliveriesPerDriver: 1,
  },
  {
    slug: "brisas-demo",
    name: "Brisas Demo",
    active: true,
    deliveryEnabled: true,
    maxDeliveries: 5,
    assignmentMode: "batch",
    maxActiveDeliveriesPerDriver: 5,
  },
];

function createMockRequest(configuration: RestaurantPublic, deliveryCount: number): DispatchRequest {
  const requestId = `WEB_${crypto.randomUUID().replaceAll("-", "")}`;
  const deliveries = configuration.assignmentMode === "individual"
    ? Array.from({ length: deliveryCount }, (_, index) => ({
      requestId: `${requestId}_${index + 1}`,
      deliveryNumber: index + 1,
      status: "open" as const,
    }))
    : [];
  const timestamp = new Date().toISOString();
  return {
    requestId,
    requestType: configuration.assignmentMode === "batch" ? "batch" : "parent",
    parentRequestId: requestId,
    deliveryCount,
    totalDeliveries: deliveryCount,
    assignedDeliveries: 0,
    remainingDeliveries: deliveryCount,
    assignmentMode: configuration.assignmentMode,
    status: "open",
    childRequestIds: deliveries.map((delivery) => delivery.requestId),
    deliveries,
    createdAt: timestamp,
  };
}

export function DispatchDemo() {
  const [scenario, setScenario] = useState(0);
  const [deliveryCount, setDeliveryCount] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  const [history, setHistory] = useState<DispatchRequest[]>([]);
  const [now, setNow] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const submissionLock = useRef(false);
  const requestRef = useRef<DispatchRequest | null>(null);
  const createdAtRef = useRef<number | null>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const keypad = useRef<HTMLDivElement>(null);
  const configuration = scenarios[scenario];

  useEffect(() => {
    mounted.current = true;
    const clock = setInterval(() => setNow(new Date().toISOString()), 1000);
    const progression = setInterval(() => {
      const current = requestRef.current;
      const createdAt = createdAtRef.current;
      if (!current || createdAt === null || !isOpenRequest(current.status)) return;
      const elapsed = Date.now() - createdAt;
      let next = current;
      if (current.assignmentMode === "batch" && elapsed >= 5000) {
        next = {
          ...current,
          status: "claimed",
          assignedDeliveries: current.totalDeliveries,
          remainingDeliveries: 0,
          driverName: "Conductor Demo",
          assignedAt: new Date(createdAt + 5000).toISOString(),
          updatedAt: new Date().toISOString(),
        };
      } else if (current.assignmentMode === "individual") {
        const target = Math.min(
          current.totalDeliveries === 1 ? 1 : current.totalDeliveries - 1,
          Math.floor(elapsed / 5000),
        );
        const deliveries = current.deliveries.map((delivery) => ({ ...delivery }));
        let assigned = deliveries.filter((delivery) => delivery.status === "claimed").length;
        for (const delivery of deliveries) {
          if (assigned >= target) break;
          if (delivery.status !== "open") continue;
          assigned += 1;
          delivery.status = "claimed";
          delivery.driverName = `Conductor Demo ${assigned}`;
          delivery.assignedAt = new Date(createdAt + assigned * 5000).toISOString();
        }
        const remaining = deliveries.filter((delivery) => delivery.status === "open").length;
        next = {
          ...current,
          deliveries,
          assignedDeliveries: assigned,
          remainingDeliveries: remaining,
          status: remaining === 0 ? "fully_assigned" : assigned > 0 ? "partially_claimed" : "open",
          updatedAt: assigned ? new Date().toISOString() : current.updatedAt,
        };
      }
      if (next !== current) {
        requestRef.current = next;
        setRequest(next);
        setHistory((previous) => previous.map((item) => item.requestId === next.requestId ? next : item));
      }
    }, 1000);
    return () => {
      mounted.current = false;
      clearInterval(clock);
      clearInterval(progression);
      if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    };
  }, []);

  const requestStatus = request?.status;
  useEffect(() => {
    if (requestStatus) heading.current?.focus();
    else keypad.current?.querySelector("button")?.focus();
  }, [requestStatus]);

  function submitRequest() {
    if (submissionLock.current || request || deliveryCount === null) return;
    submissionLock.current = true;
    setIsSubmitting(true);
    setMessage(null);
    setNotice(null);
    submitTimer.current = setTimeout(() => {
      submitTimer.current = null;
      if (!mounted.current) return;
      const created = createMockRequest(configuration, deliveryCount);
      requestRef.current = created;
      createdAtRef.current = Date.now();
      setRequest(created);
      setHistory((previous) => [created, ...previous].slice(0, 5));
      setIsSubmitting(false);
      submissionLock.current = false;
    }, 500);
  }

  function cancelRequest() {
    const current = requestRef.current;
    if (!current || !isOpenRequest(current.status) || current.remainingDeliveries === 0) return;
    if (!window.confirm(`¿Cancelar las ${current.remainingDeliveries} entregas abiertas? Las ya asignadas se conservarán.`)) return;
    const deliveries = current.deliveries.map((delivery) =>
      delivery.status === "open" ? { ...delivery, status: "cancelled" as const } : delivery);
    const next: DispatchRequest = {
      ...current,
      deliveries,
      status: "cancelled",
      remainingDeliveries: 0,
      updatedAt: new Date().toISOString(),
    };
    requestRef.current = next;
    setRequest(next);
    setHistory((previous) => previous.map((item) => item.requestId === next.requestId ? next : item));
  }

  function resendRequest() {
    const current = requestRef.current;
    if (!current || !isOpenRequest(current.status) || current.remainingDeliveries === 0) return;
    const next = { ...current, updatedAt: new Date().toISOString() };
    requestRef.current = next;
    setRequest(next);
    setHistory((previous) => previous.map((item) => item.requestId === next.requestId ? next : item));
    setNotice("Se volvieron a ofrecer únicamente las entregas pendientes.");
  }

  function newRequest() {
    if (!request || isOpenRequest(request.status)) return;
    requestRef.current = null;
    createdAtRef.current = null;
    setRequest(null);
    setDeliveryCount(null);
    setMessage(null);
    setNotice(null);
  }

  const canManage = !!request && isOpenRequest(request.status) && request.remainingDeliveries > 0;
  return (
    <DispatchFrame restaurantName={configuration.name} now={now}>
      <div className={styles.workspace}>
        <section className={styles.orderCard} aria-label="Solicitud de entregas">
          <div className={styles.cardContent}>
            {!request ? (
              <div ref={keypad}>
                <label className={styles.scenarioLabel} htmlFor="demo-scenario">Escenario de demostración</label>
                <select id="demo-scenario" className={styles.scenarioSelect} value={scenario} disabled={isSubmitting} onChange={(event) => {
                  setScenario(Number(event.target.value));
                  setDeliveryCount(null);
                }}>
                  {scenarios.map((item, index) => <option key={item.slug} value={index}>{item.name} · {item.assignmentMode === "individual" ? "individual" : "por lote"}</option>)}
                </select>
                <DeliveryKeypad
                  deliveryCount={deliveryCount}
                  maxDeliveries={configuration.maxDeliveries}
                  maxActiveDeliveriesPerDriver={configuration.maxActiveDeliveriesPerDriver}
                  assignmentMode={configuration.assignmentMode}
                  isSubmitting={isSubmitting}
                  onSelect={setDeliveryCount}
                  onSubmit={submitRequest}
                />
              </div>
            ) : (
              <DeliveryStatus request={request} headingRef={heading} now={now} />
            )}
            {request && !isOpenRequest(request.status) && (
              <button type="button" className={styles.sendButton} onClick={newRequest}>NUEVA SOLICITUD</button>
            )}
            {request && canManage && (
              <>
                <button type="button" className={styles.sendButton} onClick={resendRequest}>VOLVER A OFRECER PENDIENTES</button>
                <button type="button" className={styles.cancelButton} onClick={cancelRequest}>CANCELAR ENTREGAS PENDIENTES</button>
              </>
            )}
            {request && <p className={styles.cancelHint}>La demostración avanza localmente; usa la reoferta o cancelación solo sobre entregas pendientes.</p>}
            {notice && <p className={styles.soundNotice} role="status">{notice}</p>}
            {message && <p className={styles.errorNotice} role="alert">{message}</p>}
          </div>
          <div className={styles.cardFooter}><span aria-hidden="true">✓</span> Solicitudes simuladas · Sin envíos reales</div>
        </section>
        <DeliveryHistory requests={history} />
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {request ? `Solicitud ${request.requestId}: ${request.status}.` : "Selecciona la cantidad de entregas."}
      </p>
    </DispatchFrame>
  );
}
