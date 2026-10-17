import { useId } from "react";
import type { DispatchRequest } from "@/lib/dispatch/dispatch-types";
import {
  cancelActionLabel,
  displayLabel,
  displayStatus,
  formatElapsed,
  needsAttention,
} from "@/lib/dispatch/dispatch-queue";
import { deliveryOrders, getDeliveryProgress, requestGroupProgress, requestGroupTitle } from "@/lib/dispatch/delivery-progress";
import { DeliveryAlert } from "./DeliveryAlert";
import { DeliveryOrderCard } from "./DeliveryOrderCard";
import { DeliveryProgress } from "./DeliveryProgress";
import styles from "./DispatchTerminal.module.css";

export interface CardActions {
  canResend: boolean;
  canCancel: boolean;
  busyAction: "resend" | "cancel" | null;
  disabled: boolean;
  onResend: () => void;
  onCancel: () => void;
  /**
   * Reserved for a future server capability ("ASIGNAR OTRA A [CONDUCTOR]").
   * The button only renders when the server exposes a real endpoint and this is provided.
   */
  assignAnother?: { driverName: string; onAssign: () => void };
}

function RequestActions({ request, actions }: { request: DispatchRequest; actions?: CardActions }) {
  if (!actions || !(actions.canResend || actions.canCancel || actions.assignAnother)) return null;
  return (
    <div className={styles.cardActions}>
      {actions.canResend && (
        <button type="button" className={styles.secondaryButton} disabled={actions.disabled} onClick={actions.onResend}>
          {actions.busyAction === "resend" && <span className={styles.spinner} aria-hidden="true" />}
          {actions.busyAction === "resend" ? "OFRECIENDO…" : "VOLVER A OFRECER"}
        </button>
      )}
      {actions.assignAnother && (
        <button type="button" className={styles.secondaryButton} disabled={actions.disabled} onClick={actions.assignAnother.onAssign}>
          ASIGNAR OTRA A {actions.assignAnother.driverName.toUpperCase()}
        </button>
      )}
      {actions.canCancel && (
        <button
          type="button"
          className={styles.dangerOutlineButton}
          disabled={actions.disabled}
          aria-busy={actions.busyAction === "cancel"}
          onClick={actions.onCancel}
        >
          {actions.busyAction === "cancel" && <span className={styles.spinner} aria-hidden="true" />}
          {actions.busyAction === "cancel" ? "Cancelando…" : cancelActionLabel(request)}
        </button>
      )}
    </div>
  );
}

function WaitingNotice({ request, nowMs }: { request: DispatchRequest; nowMs: number | null }) {
  if (request.noDriverAlerted && request.remainingDeliveries > 0) {
    return <DeliveryAlert>{getDeliveryProgress("no_driver_alerted").alert}</DeliveryAlert>;
  }
  if (nowMs !== null && needsAttention(request, nowMs)) {
    return <DeliveryAlert>Han pasado más de 20 segundos sin conductor. La solicitud sigue disponible.</DeliveryAlert>;
  }
  return null;
}

/**
 * A restaurant request on the live board. Single-delivery (and batch) requests render as one order card;
 * multi-delivery requests get a group header ("SOLICITUD #E814C7 · 2 de 3 asignadas") and one card per delivery.
 */
export function DeliveryRequestGroup({ request, nowMs, restaurantName, actions, onDismiss }: {
  request: DispatchRequest;
  nowMs: number | null;
  restaurantName?: string;
  actions?: CardActions;
  onDismiss?: () => void;
}) {
  const titleId = useId();
  const orders = deliveryOrders(request);
  const elapsed = nowMs !== null ? <span>Hace {formatElapsed(request.createdAt, nowMs)}</span> : null;
  const dismiss = onDismiss && (
    <button type="button" className={styles.linkButton} onClick={onDismiss}>Ocultar de la lista</button>
  );
  if (orders.length === 1) {
    return (
      <DeliveryOrderCard order={orders[0]} restaurantName={restaurantName ?? request.restaurantName} meta={elapsed} showAlert={false}>
        <WaitingNotice request={request} nowMs={nowMs} />
        <RequestActions request={request} actions={actions} />
        {dismiss}
      </DeliveryOrderCard>
    );
  }
  const status = displayStatus(request);
  return (
    <section className={styles.requestGroup} data-status={status} aria-labelledby={titleId}>
      <header className={styles.requestHeader}>
        <div>
          <h3 id={titleId} className={styles.groupTitle}>
            {requestGroupTitle(request)} <span className={styles.groupProgress}>· {requestGroupProgress(request)}</span>
          </h3>
          <p className={styles.requestMeta}>
            {restaurantName ?? request.restaurantName}{(restaurantName ?? request.restaurantName) && elapsed ? " · " : ""}{elapsed}
          </p>
        </div>
        <span className={styles.statusBadge} data-status={status}>{displayLabel(request)}</span>
      </header>
      <DeliveryProgress request={request} />
      <WaitingNotice request={request} nowMs={nowMs} />
      <RequestActions request={request} actions={actions} />
      <ol className={styles.orderList}>
        {orders.map((order) => (
          <li key={order.orderNumber}><DeliveryOrderCard order={order} headingLevel={4} showAlert={false} /></li>
        ))}
      </ol>
      {dismiss}
    </section>
  );
}
