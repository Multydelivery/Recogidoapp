import type { DispatchRequest } from "@/lib/dispatch/dispatch-types";
import { requestOrderNumber } from "@/lib/dispatch/delivery-progress";
import { DeliveryRequestGroup, type CardActions } from "./DeliveryRequestGroup";
import styles from "./DispatchTerminal.module.css";

/**
 * One live board section ("Buscando conductor" or "Entregas en curso").
 * An empty section is never confused with a connection failure.
 */
export function ActiveDeliveriesSection({
  id, title, emptyText, loadingText, requests, finished = [], nowMs, hasLoaded, unavailable = false,
  lastUpdateLabel, restaurantName, actionsFor, onDismissFinished,
}: {
  id: "searching" | "in-progress";
  title: string;
  emptyText: string;
  loadingText: string;
  /** Already sorted by urgency. */
  requests: readonly DispatchRequest[];
  finished?: readonly DispatchRequest[];
  nowMs: number | null;
  hasLoaded: boolean;
  /** True when the queue could not be loaded at all (distinct from an empty queue). */
  unavailable?: boolean;
  lastUpdateLabel?: string | null;
  restaurantName?: string;
  actionsFor?: (request: DispatchRequest) => CardActions | undefined;
  onDismissFinished?: (requestId: string) => void;
}) {
  const titleId = `${id}-title`;
  return (
    <section className={styles.queue} aria-labelledby={titleId} data-section={id}>
      <div className={styles.queueHeading}>
        <h2 id={titleId} className={styles.cardTitle}>
          {title} <span className={styles.countBadge}>{requests.length}</span>
        </h2>
        {lastUpdateLabel && <p className={styles.lastUpdate}>{lastUpdateLabel}</p>}
      </div>
      {requests.length === 0 ? (
        <p className={styles.emptyState}>
          {unavailable && !hasLoaded
            ? "No se pudo cargar la cola. Revise la conexión e intente de nuevo."
            : hasLoaded ? emptyText : loadingText}
        </p>
      ) : (
        <ol className={styles.requestList}>
          {requests.map((request) => (
            <li key={requestOrderNumber(request) + request.createdAt}>
              <DeliveryRequestGroup request={request} nowMs={nowMs} restaurantName={restaurantName} actions={actionsFor?.(request)} />
            </li>
          ))}
        </ol>
      )}
      {finished.length > 0 && (
        <>
          <h3 className={styles.subheading}>Finalizadas recientemente</h3>
          <ol className={styles.requestList}>
            {finished.map((request) => (
              <li key={requestOrderNumber(request) + request.createdAt}>
                <DeliveryRequestGroup request={request} nowMs={nowMs} restaurantName={restaurantName}
                  onDismiss={onDismissFinished ? () => onDismissFinished(request.requestId) : undefined} />
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
