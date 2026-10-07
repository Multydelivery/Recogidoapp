import { demoStatusLabels, formatDemoTime, type DemoRequest } from "@/lib/dispatch/demo-types";
import styles from "./DispatchDemo.module.css";

export function DeliveryHistory({ requests }: { requests: DemoRequest[] }) {
  return (
    <aside className={styles.history} aria-labelledby="history-title">
      <div className={styles.historyHeading}>
        <div>
          <p className={styles.eyebrow}>ACTIVIDAD</p>
          <h2 id="history-title">Historial del día</h2>
        </div>
        <span className={styles.historyCount}>{requests.length}</span>
      </div>
      <p className={styles.historyHint}>Últimas cinco solicitudes de esta sesión.</p>
      {requests.length === 0 ? (
        <div className={styles.emptyHistory}>
          <span aria-hidden="true">↗</span>
          <p>Aún no hay solicitudes</p>
          <p>Tu primera entrega aparecerá aquí.</p>
        </div>
      ) : (
        <ol className={styles.historyList}>
          {requests.map((request) => (
            <li key={request.requestId}>
              <div className={styles.historyRow}>
                <strong>{request.deliveryCount} {request.deliveryCount === 1 ? "entrega" : "entregas"}</strong>
                <time dateTime={request.createdAt}>{formatDemoTime(request.createdAt)}</time>
              </div>
              <p className={styles.shortId} title={request.requestId} aria-label={`Solicitud ${request.requestId}`}>
                DEMO_…{request.requestId.slice(-6)}
              </p>
              <p className={styles.historyStatus} data-status={request.status}>
                <span aria-hidden="true">●</span> {demoStatusLabels[request.status]}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className={styles.memoryNote}>Solo en memoria. Al recargar, el historial se borra.</p>
    </aside>
  );
}
