import styles from "./DispatchDemo.module.css";

interface DeliveryKeypadProps {
  deliveryCount: number | null;
  showMore: boolean;
  isSubmitting: boolean;
  onSelect: (count: number) => void;
  onShowMore: () => void;
  onSubmit: () => void;
}

export function DeliveryKeypad({
  deliveryCount,
  showMore,
  isSubmitting,
  onSelect,
  onShowMore,
  onSubmit,
}: DeliveryKeypadProps) {
  return (
    <div aria-busy={isSubmitting}>
      <p className={styles.eyebrow}>NUEVA ENTREGA</p>
      <h1 className={styles.title}>¿Cuántas entregas necesitas?</h1>
      <p className={styles.subtitle}>Selecciona la cantidad y envía tu solicitud.</p>

      <fieldset disabled={isSubmitting} className={styles.keypadFieldset}>
        <legend className="sr-only">Cantidad de entregas</legend>
        <div className={styles.keypad}>
          {[1, 2, 3].map((count) => (
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
          <button
            type="button"
            className={styles.quantity}
            aria-label="Elegir entre 4 y 9 entregas"
            aria-expanded={showMore}
            aria-controls="more-deliveries"
            aria-pressed={deliveryCount !== null && deliveryCount >= 4}
            onClick={onShowMore}
          >
            <span className={styles.quantityNumber}>4+</span>
            <span>ENTREGAS</span>
          </button>
        </div>
        {showMore && (
          <div id="more-deliveries" className={styles.moreQuantities} role="group" aria-label="De 4 a 9 entregas">
            {[4, 5, 6, 7, 8, 9].map((count) => (
              <button
                key={count}
                type="button"
                className={styles.moreQuantity}
                aria-label={`${count} entregas`}
                aria-pressed={deliveryCount === count}
                onClick={() => onSelect(count)}
              >
                {count}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <p className={styles.selection} role="status">
        {deliveryCount === null
          ? "Selecciona una cantidad para continuar"
          : `${deliveryCount} ${deliveryCount === 1 ? "entrega seleccionada" : "entregas seleccionadas"}`}
      </p>
      <button
        type="button"
        className={styles.sendButton}
        disabled={deliveryCount === null || isSubmitting}
        onClick={onSubmit}
      >
        {isSubmitting && <span className={styles.spinner} aria-hidden="true" />}
        {isSubmitting ? "ENVIANDO SOLICITUD…" : "ENVIAR SOLICITUD"}
      </button>
    </div>
  );
}
