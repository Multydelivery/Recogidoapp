import type { DriverOffer } from "@/lib/driver/driver-types";
import { assignmentModeLabel, formatDriverTime, formatElapsed, orderLabel } from "@/lib/driver/driver-demo";
import styles from "./DriverDemo.module.css";

export function OfferCard({ offer, nowMs, loading, acceptBlockedReason, actionsDisabled, onAccept, onDecline, disableBlocked = false }: {
  offer: DriverOffer;
  nowMs: number | null;
  loading: boolean;
  /** When set, the accept button stays enabled so the driver gets the explanation, but no request is simulated. */
  acceptBlockedReason?: string;
  actionsDisabled: boolean;
  disableBlocked?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const label = orderLabel(offer.orderNumber);
  const headingId = `offer-${offer.offerId}-title`;
  return (
    <article className={styles.card} aria-labelledby={headingId} aria-busy={loading}>
      <div className={styles.cardTop}>
        <h3 id={headingId} className={styles.orderNumber}>{label}</h3>
        <span className={styles.modeChip} data-mode={offer.assignmentMode}>{assignmentModeLabel(offer.assignmentMode)}</span>
      </div>
      <p className={styles.restaurant}>{offer.restaurantName}</p>
      <dl className={styles.facts}>
        <div><dt>Asignación</dt><dd>{offer.assignmentLabel}</dd></div>
        <div>
          <dt>Recibida</dt>
          <dd>
            {nowMs === null || !offer.createdAt ? "—" : (
              <time dateTime={offer.createdAt}>{formatDriverTime(offer.createdAt)} · {formatElapsed(offer.createdAt, nowMs)}</time>
            )}
          </dd>
        </div>
      </dl>
      {acceptBlockedReason && (
        <p className={styles.cardNotice} id={`offer-${offer.offerId}-blocked`}>
          <span aria-hidden="true">⚠</span> {acceptBlockedReason}
        </p>
      )}
      <div className={styles.cardActions}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={actionsDisabled || (disableBlocked && Boolean(acceptBlockedReason))}
          aria-disabled={acceptBlockedReason ? true : undefined}
          aria-describedby={acceptBlockedReason ? `offer-${offer.offerId}-blocked` : undefined}
          data-blocked={acceptBlockedReason ? "true" : undefined}
          onClick={onAccept}
        >
          {loading && <span className={styles.spinner} aria-hidden="true" />}
          {loading ? "TOMANDO ENTREGA…" : "TOMAR ENTREGA"}
          <span className="sr-only"> {label}</span>
        </button>
        <button type="button" className={styles.secondaryButton} disabled={actionsDisabled} onClick={onDecline}>
          NO DISPONIBLE<span className="sr-only"> para {label}</span>
        </button>
      </div>
    </article>
  );
}
