import type { Ref } from "react";
import { CarIcon, CheckIcon, DispatchIcon } from "@/components/icons";
import { dispatchStatusLabels, isOpenRequest, type DispatchRequest } from "@/lib/dispatch/dispatch-types";
import { formatDemoTime } from "@/lib/dispatch/demo-types";
import styles from "./DispatchDemo.module.css";

export function DeliveryStatus({ request, headingRef, now }: {
  request: DispatchRequest;
  headingRef: Ref<HTMLHeadingElement>;
  now: string | null;
}) {
  const open = isOpenRequest(request.status);
  const cancelled = request.status === "cancelled";
  const closed = request.status === "closed";
  const assigned = request.status === "fully_assigned" || request.status === "claimed" ||
    (closed && request.assignedDeliveries === request.totalDeliveries);
  const pendingForMs = Date.parse(now ?? request.createdAt) - Date.parse(request.createdAt);
  const noDriver = open && request.remainingDeliveries > 0 && pendingForMs >= 20_000;
  const panelClass = cancelled ? styles.cancelledPanel : open ? styles.warningPanel : styles.successPanel;
  const heading = cancelled
    ? "SOLICITUD CANCELADA"
    : assigned
      ? "TODAS ASIGNADAS"
      : closed
        ? "SOLICITUD CERRADA"
        : noDriver
          ? "SIN CONDUCTOR DESPUÉS DE 20 SEGUNDOS"
          : request.status === "partially_claimed"
            ? "PARCIALMENTE ASIGNADA"
            : "BUSCANDO CONDUCTORES";
  const assignments = request.assignmentMode === "batch"
    ? [{
      requestId: request.requestId,
      deliveryNumber: request.totalDeliveries,
      status: request.status === "cancelled" ? "cancelled" as const :
        closed ? "closed" as const : assigned ? "claimed" as const : "open" as const,
      ...(request.driverName ? { driverName: request.driverName } : {}),
      ...(request.assignedAt ? { assignedAt: request.assignedAt } : {}),
    }]
    : request.deliveries;

  return (
    <div className={`${styles.statusPanel} ${panelClass}`}>
      <div className={styles.statusIcon} aria-hidden="true">
        {cancelled ? <span>×</span> : assigned ? <CarIcon /> : <DispatchIcon />}
      </div>
      <h1 className={styles.statusTitle} tabIndex={-1} ref={headingRef}>{heading}</h1>
      <p className={styles.deliveryTotal}>
        {request.assignmentMode === "batch"
          ? `${request.totalDeliveries} ${request.totalDeliveries === 1 ? "ENTREGA" : "ENTREGAS"} EN UN LOTE`
          : `${request.assignedDeliveries} ASIGNADAS · ${request.remainingDeliveries} PENDIENTES`}
      </p>
      {request.assignmentMode === "individual" && request.deliveries.length > 0 ? (
        <ol className={styles.deliveryCards} aria-label="Estado de cada entrega">
          {request.deliveries.map((delivery) => (
            <li className={styles.deliveryCard} key={delivery.requestId}>
              <strong>Entrega {delivery.deliveryNumber} de {request.totalDeliveries}</strong>
              <span className={styles.deliveryState} data-status={delivery.status}>
                {delivery.status === "claimed" ? "Asignada" :
                  delivery.status === "closed" ? "Cerrada" :
                  delivery.status === "cancelled" ? "Cancelada" : "Pendiente"}
              </span>
              {delivery.driverName && <span>Conductor: {delivery.driverName}</span>}
              {delivery.assignedAt && <time dateTime={delivery.assignedAt}>Asignada a las {formatDemoTime(delivery.assignedAt)}</time>}
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.deliveryCards} aria-label="Estado del lote">
          {assignments.map((assignment) => (
            <div className={styles.deliveryCard} key={assignment.requestId}>
              <strong>{request.totalDeliveries} {request.totalDeliveries === 1 ? "entrega" : "entregas"} · lote completo</strong>
              <span className={styles.deliveryState} data-status={assignment.status}>
                {assignment.status === "claimed" ? "Asignado" :
                  assignment.status === "closed" ? "Cerrado" :
                  assignment.status === "cancelled" ? "Cancelado" : "Pendiente"}
              </span>
              {assignment.driverName && <span>Conductor: {assignment.driverName}</span>}
              {assignment.assignedAt && <time dateTime={assignment.assignedAt}>Asignado a las {formatDemoTime(assignment.assignedAt)}</time>}
            </div>
          ))}
        </div>
      )}
      {noDriver && (
        <p className={styles.noDriverAlert} role="status">
          {request.remainingDeliveries} {request.remainingDeliveries === 1 ? "entrega sigue pendiente" : "entregas siguen pendientes"} después de 20 segundos.
        </p>
      )}
      {request.status === "partially_claimed" && !noDriver && (
        <p className={styles.searching}><CheckIcon aria-hidden="true" /> Buscando conductores para las entregas pendientes</p>
      )}
      {assigned && <p className={styles.searching}><CheckIcon aria-hidden="true" /> {dispatchStatusLabels[request.status]}</p>}
      {cancelled && <p>Las entregas ya asignadas se conservaron; se detuvo la oferta de las pendientes.</p>}
      <p className={styles.requestId}>Solicitud: <span>{request.requestId}</span></p>
    </div>
  );
}
