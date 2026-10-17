import styles from "./DispatchTerminal.module.css";

export function ConnectionBanner({ message, lastUpdateLabel, retrying, onRetry }: {
  message: string;
  lastUpdateLabel?: string | null;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={styles.connectionBanner} role="alert">
      <div>
        <strong><span aria-hidden="true">!</span> No hay conexión con el servidor</strong>
        <p>{message}</p>
        <p>Se mantienen los últimos datos recibidos.{lastUpdateLabel ? ` ${lastUpdateLabel}.` : ""}</p>
      </div>
      <button type="button" className={styles.secondaryButton} disabled={retrying} onClick={onRetry}>
        {retrying ? "Reintentando…" : "Reintentar"}
      </button>
    </div>
  );
}
