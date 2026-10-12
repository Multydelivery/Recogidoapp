import type { AssignmentMode } from "@/lib/dispatch/dispatch-types";
import styles from "./DispatchDemo.module.css";

interface DeliveryKeypadProps {
  deliveryCount: number | null;
  maxDeliveries: number;
  maxActiveDeliveriesPerDriver: number;
  assignmentMode: AssignmentMode;
  isSubmitting: boolean;
  isDisabled?: boolean;
  onSelect: (count: number) => void;
  onSubmit: () => void;
}

export function DeliveryKeypad({
  deliveryCount,
  maxDeliveries,
  maxActiveDeliveriesPerDriver,
  assignmentMode,
  isSubmitting,
  isDisabled = false,
  onSelect,
  onSubmit,
}: DeliveryKeypadProps) {
  const isIndividual = assignmentMode === "individual";

  return (
    <div aria-busy={isSubmitting}>
      <p className={styles.eyebrow}>NUEVA SOLICITUD</p>
      <h1 className={styles.title}>¿Cuántas entregas necesitas?</h1>
      <p className={styles.assignmentMode}>{isIndividual ? "Asignación individual" : "Asignación por lote"}</p>
      <p className={styles.subtitle}>
        {isIndividual
          ? "Cada entrega se ofrece por separado y puede asignarse a un conductor distinto."
          : "Un solo conductor acepta el lote completo de entregas."}
      </p>
      <p className={styles.limitNote}>
        Máximo {maxDeliveries} {maxDeliveries === 1 ? "entrega" : "entregas"} por solicitud ·
        {" "}máximo {maxActiveDeliveriesPerDriver} {maxActiveDeliveriesPerDriver === 1 ? "entrega activa" : "entregas activas"} por conductor
      </p>

      <fieldset disabled={isSubmitting || isDisabled} className={styles.keypadFieldset}>
        <legend className="sr-only">Cantidad de entregas</legend>
        <div className={styles.keypad}>
          {Array.from({ length: maxDeliveries }, (_, index) => index + 1).map((count) => (
            <button
              key={count}
              type="button"
              className={styles.quantity}
              aria-pressed={deliveryCount === count}
              onClick={() => onSelect(count)}
            >
              <span className={styles.quantityNumber}>{count}</span>
              <span>{count === 1 ? "ENTREGA" : "ENTREGAS"}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <p className={styles.selection} role="status">
        {deliveryCount === null
          ? `Selecciona de 1 a ${maxDeliveries} entregas`
          : `${deliveryCount} ${deliveryCount === 1 ? "entrega seleccionada" : "entregas seleccionadas"}`}
      </p>
      <button
        type="button"
        className={styles.sendButton}
        disabled={deliveryCount === null || isSubmitting || isDisabled}
        onClick={onSubmit}
      >
        {isSubmitting && <span className={styles.spinner} aria-hidden="true" />}
        {isSubmitting ? "CREANDO SOLICITUD…" : "ENVIAR SOLICITUD"}
      </button>
    </div>
  );
}
