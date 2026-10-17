"use client";

import { useId, useState } from "react";
import type { DispatchHistoryRecord } from "@/lib/dispatch/dispatch-types";
import { formatDateTime, historyOutcome, historyOutcomeLabels } from "@/lib/dispatch/dispatch-queue";
import { fallbackOrderNumber, orderBase } from "@/lib/dispatch/dispatch-types";
import { formatOrderNumber, historyOrders } from "@/lib/dispatch/delivery-progress";
import { DeliveryIcon, type DeliveryIconName } from "./DeliveryIcon";
import { DeliveryOrderCard } from "./DeliveryOrderCard";
import styles from "./DispatchTerminal.module.css";

export const historyPageSize = 10;

const outcomeIcon: Record<ReturnType<typeof historyOutcome>, DeliveryIconName> = {
  completed: "check",
  partially_completed: "alert",
  cancelled: "x",
  closed: "flag",
  in_progress: "truck",
};

function plural(count: number, singular: string, pluralWord: string) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

export function historyOrderNumber(record: Pick<DispatchHistoryRecord, "requestId" | "orderNumber">) {
  return orderBase(record.orderNumber ?? fallbackOrderNumber(record.requestId));
}

/** A finished request: final status, drivers and times, with the per-delivery timeline collapsed by default. */
export function HistoryCard({ record }: { record: DispatchHistoryRecord }) {
  const titleId = useId();
  const outcome = historyOutcome(record);
  const orders = historyOrders(record);
  const orderNumber = formatOrderNumber(historyOrderNumber(record));
  return (
    <article className={styles.historyCard} data-outcome={outcome} aria-labelledby={titleId}>
      <header className={styles.requestHeader}>
        <div>
          <span className={styles.orderEyebrow}>Orden</span>
          <h3 id={titleId} className={styles.orderNumber}>{orderNumber}</h3>
          <p className={styles.requestMeta}>
            <time dateTime={record.finalizedAt ?? record.createdAt}>{formatDateTime(record.finalizedAt ?? record.createdAt)}</time>
          </p>
        </div>
        <span className={styles.statusBadge} data-status={outcome}>
          <DeliveryIcon name={outcomeIcon[outcome]} /> {historyOutcomeLabels[outcome]}
        </span>
      </header>
      <dl className={styles.progressCounts}>
        <div><dt>Total</dt><dd>{record.totalDeliveries}</dd></div>
        <div><dt>Completadas</dt><dd>{record.completedDeliveries}</dd></div>
        <div><dt>Canceladas</dt><dd>{record.cancelledDeliveries}</dd></div>
      </dl>
      <p className={styles.requestMeta}>
        {record.driverNames.length === 0
          ? "Sin conductor asignado"
          : `${record.driverNames.length === 1 ? "Conductor" : "Conductores"}: ${record.driverNames.join(", ")}`}
      </p>
      <p className={styles.requestMeta}>Creada: <time dateTime={record.createdAt}>{formatDateTime(record.createdAt)}</time></p>
      {orders.length > 0 && (
        <details className={styles.historyDetails}>
          <summary>Ver detalles</summary>
          <ol className={styles.orderList} aria-label={`Entregas de la orden ${orderNumber}`}>
            {orders.map((order) => (
              <li key={order.orderNumber}><DeliveryOrderCard order={order} headingLevel={4} /></li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

/**
 * "HISTORIAL": real completed and cancelled requests returned by the server, newest first.
 * Never mixed with the active board and never invented. "VER MÁS" only reveals more of the records
 * already loaded; it does not query the server again.
 */
export function DeliveryHistorySection({ records, available, loaded, loading = false, error = null, onRefresh, initialVisible = historyPageSize }: {
  /** Already sorted by finalizedAt, newest first. */
  records: readonly DispatchHistoryRecord[];
  available: boolean;
  loaded: boolean;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  initialVisible?: number;
}) {
  const [visible, setVisible] = useState(initialVisible);
  const finished = records.filter((record) => historyOutcome(record) !== "in_progress");
  const shown = finished.slice(0, visible);
  return (
    <section className={styles.card} aria-labelledby="history-title" aria-busy={loading} data-section="history">
      <div className={styles.queueHeading}>
        <h2 id="history-title" className={styles.cardTitle}>
          Historial {loaded && <span className={styles.countBadge}>{finished.length}</span>}
        </h2>
        {available && onRefresh && (
          <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={loading}>
            {loading && <span className={styles.spinner} aria-hidden="true" />}
            {loading ? "ACTUALIZANDO…" : "ACTUALIZAR HISTORIAL"}
          </button>
        )}
      </div>
      <p className={styles.lastUpdate} aria-live="polite">{loading && loaded ? "Actualizando historial…" : ""}</p>
      {!available ? (
        <p className={styles.hint}>El historial real estará disponible próximamente.</p>
      ) : (
        <>
          {error && (
            <p className={styles.inlineNotice} role="status">
              {error}{loaded ? " Se muestran los últimos datos recibidos." : ""}
            </p>
          )}
          {!loaded ? (
            !error && <p className={styles.emptyState}>Cargando historial…</p>
          ) : finished.length === 0 ? (
            <p className={styles.emptyState}>Todavía no hay entregas en el historial.</p>
          ) : (
            <>
              <ol className={styles.historyGrid}>
                {shown.map((record) => (
                  <li key={historyOrderNumber(record) + record.createdAt}><HistoryCard record={record} /></li>
                ))}
              </ol>
              <p className={styles.lastUpdate}>
                Mostrando {shown.length} de {plural(finished.length, "solicitud", "solicitudes")}
              </p>
              {shown.length < finished.length && (
                <button type="button" className={styles.secondaryButton} onClick={() => setVisible((count) => count + historyPageSize)}>
                  VER MÁS
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
