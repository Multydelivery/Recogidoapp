import { demoStatusLabels, formatDemoTime, type DemoRequest } from "@/lib/dispatch/demo-types";
import { dispatchStatusLabels, type DispatchRequest } from "@/lib/dispatch/dispatch-types";
import styles from "./DispatchDemo.module.css";

const labels = { ...demoStatusLabels, ...dispatchStatusLabels };

export function DeliveryHistory({ requests, serverBacked = false, mockMode = true }: {
  requests: (DemoRequest | DispatchRequest)[];
  serverBacked?: boolean;
  mockMode?: boolean;
}) {
  return (
    <aside className={styles.history} aria-labelledby="history-title">
      <div className={styles.historyHeading}>
        <div>
          <p className={styles.eyebrow}>ACTIVIDAD</p>
          <h2 id="history-title">Historial del día</h2>
        </div>
        <span className={styles.historyCount}>{requests.length}</span>
      </div>
      <p className={styles.historyHint}>{serverBacked && mockMode ? "Últimas cinco solicitudes del restaurante." : "Últimas cinco solicitudes de esta sesión."}</p>
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
                {request.requestId.split("_")[0]}_…{request.requestId.slice(-6)}
              </p>
              <p className={styles.historyStatus} data-status={request.status}>
                <span aria-hidden="true">●</span> {labels[request.status]}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className={styles.memoryNote}>{serverBacked ? mockMode ? "Simulación en memoria del servidor. Se borra al reiniciar y caduca a las 24 horas." : "Estados del servicio central. El historial local conserva las solicitudes vistas en esta sesión." : "Solo en memoria. Al recargar, el historial se borra."}</p>
    </aside>
  );
}
