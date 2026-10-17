import type { AssignmentMode } from "@/lib/dispatch/dispatch-types";
import styles from "./DispatchTerminal.module.css";

export function NewDeliveryRequest({
  maxDeliveries,
  assignmentMode,
  selected,
  submitting,
  disabledReason,
  lastCreatedLabel,
  onSelect,
  onSubmit,
}: {
  maxDeliveries: number;
  assignmentMode: AssignmentMode;
  selected: number | null;
  submitting: boolean;
  disabledReason?: string | null;
  lastCreatedLabel?: string | null;
  onSelect: (count: number) => void;
  onSubmit: () => void;
}) {
  const disabled = submitting || !!disabledReason;
  return (
    <section className={styles.card} aria-labelledby="new-request-title" aria-busy={submitting}>
      <h2 id="new-request-title" className={styles.cardTitle}>Nueva solicitud de entrega</h2>
      <p className={styles.instruction}>Seleccione cuántas entregas necesita</p>
      <fieldset className={styles.quantityGroup} disabled={disabled}>
        <legend className="sr-only">Cantidad de entregas</legend>
        {Array.from({ length: maxDeliveries }, (_, index) => index + 1).map((count) => (
          <button
            key={count}
            type="button"
            className={styles.quantityButton}
            aria-pressed={selected === count}
            aria-label={`${count} ${count === 1 ? "entrega" : "entregas"}`}
            onClick={() => onSelect(count)}
          >
            {count}
          </button>
        ))}
      </fieldset>
      <p className={styles.selectedCount} aria-live="polite">
        {selected === null
          ? "Ninguna cantidad seleccionada"
          : <>Seleccionadas: <strong>{selected} {selected === 1 ? "entrega" : "entregas"}</strong></>}
      </p>
      {assignmentMode === "batch" && <p className={styles.hint}>Un solo conductor recibirá todas las entregas.</p>}
      <button
        type="button"
        className={styles.primaryButton}
        disabled={selected === null || disabled}
        onClick={onSubmit}
      >
        {submitting && <span className={styles.spinner} aria-hidden="true" />}
        {submitting ? "ENVIANDO…" : "SOLICITAR CONDUCTOR"}
      </button>
      {disabledReason && <p className={styles.hint}>{disabledReason}</p>}
      {lastCreatedLabel && !submitting && (
        <p className={styles.createdNotice} role="status">
          <span aria-hidden="true">✓</span> {lastCreatedLabel}
        </p>
      )}
    </section>
  );
}
