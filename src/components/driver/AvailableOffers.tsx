import type { DriverOffer } from "@/lib/driver/driver-types";
import type { AcceptCheck } from "@/lib/driver/driver-demo";
import { OfferCard } from "./OfferCard";
import styles from "./DriverDemo.module.css";

export function AvailableOffers({ offers, nowMs, unavailable, pendingOfferId, busy, checkOffer, onAccept, onDecline, onReset }: {
  offers: DriverOffer[];
  nowMs: number | null;
  unavailable: boolean;
  pendingOfferId: string | null;
  busy: boolean;
  checkOffer: (offer: DriverOffer) => AcceptCheck;
  onAccept: (offer: DriverOffer) => void;
  onDecline: (offer: DriverOffer) => void;
  onReset: () => void;
}) {
  return (
    <>
      {unavailable && (
        <p className={styles.unavailableNotice} role="note">
          <strong><span aria-hidden="true">○</span> Está No disponible.</strong> No puede aceptar ofertas.
          Active <strong>Disponible</strong> en la parte superior para volver a recibirlas.
        </p>
      )}
      {offers.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No hay ofertas disponibles</p>
          <p>Las nuevas solicitudes aparecerán aquí.</p>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onReset}>
            Restablecer ofertas de demostración
          </button>
        </div>
      ) : (
        <ul className={styles.list} aria-label={`${offers.length} ${offers.length === 1 ? "oferta disponible" : "ofertas disponibles"}`}>
          {offers.map((offer) => {
            const check = checkOffer(offer);
            const blockedReason = !check.ok && pendingOfferId === null ? check.reason : undefined;
            return (
              <li key={offer.offerId}>
                <OfferCard
                  offer={offer}
                  nowMs={nowMs}
                  loading={pendingOfferId === offer.offerId}
                  acceptBlockedReason={unavailable ? undefined : blockedReason}
                  actionsDisabled={busy}
                  onAccept={() => onAccept(offer)}
                  onDecline={() => onDecline(offer)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
