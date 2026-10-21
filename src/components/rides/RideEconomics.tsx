"use client";

import { CheckIcon } from "@/components/icons";
import { cancellationPolicyText, formatCents, money, type RideRequest } from "@/lib/rides/demo";
import type { RidePricing } from "@/lib/rides/pricing";
import { calculateRideMetrics, type Indicator } from "@/lib/rides/metrics";
import type { useRideDemo } from "@/lib/rides/useRideDemo";
import styles from "./RideDemo.module.css";

type Demo = ReturnType<typeof useRideDemo>;
export function PricingBreakdown({ pricing }: { pricing: RidePricing }) {
  return <div className={styles.quote}>
    <h3><CheckIcon aria-hidden="true" />Cotización Recogido · Simulación</h3>
    <dl className={styles.moneyRows}>
      <div><dt>Costo estimado del viaje</dt><dd>{formatCents(pricing.providerEstimateCents)}</dd></div>
      <div><dt>Coordinación Recogido</dt><dd>{formatCents(pricing.coordinationFeeCents)}</dd></div>
      <div className={styles.totalRow}><dt>Total estimado</dt><dd>{formatCents(pricing.customerTotalCents)}</dd></div>
      <div><dt>Retención temporal</dt><dd>{formatCents(pricing.temporaryReserveCents)}</dd></div>
      <div className={styles.totalRow}><dt>Monto máximo autorizado</dt><dd>{formatCents(pricing.authorizationTotalCents)}</dd></div>
    </dl>
    <p>La retención temporal cubre posibles cambios en la tarifa del proveedor. La parte no utilizada se libera después de finalizar el viaje.</p>
    <p>Recogido coordina; no es el proveedor de transporte. No se realiza ningún pago real.</p>
  </div>;
}
export function PaymentDemo({ ride, demo }: { ride: RideRequest; demo: Demo }) {
  if (!["quote_created", "payment_failed", "payment_pending"].includes(ride.status)) return null;
  return <section className={styles.operations} aria-label="Pago de prueba">
    <h3>Pago de prueba</h3><p>La autorización y la solicitud del viaje se simulan automáticamente después de tu aceptación.</p>
    {ride.status !== "payment_pending" ? <>
      <label className={styles.checkbox}><input type="checkbox" checked={ride.cancellationPolicyAccepted}
        onChange={(event) => demo.act(ride.id, { type: "accept_policy", accepted: event.target.checked })} /><span>{cancellationPolicyText}</span></label>
      <button type="button" className={`${styles.primary} ${styles.mainAction}`} disabled={!ride.cancellationPolicyAccepted}
        onClick={() => demo.act(ride.id, { type: "start_payment" })}>
        {ride.status === "payment_failed" ? "Reintentar pago de prueba" : "Aceptar precio y autorizar pago de prueba"}
      </button>
      {ride.status === "payment_failed" && <p role="status" className={styles.loss}>Pago rechazado en la simulación. No se reservó un viaje. El reintento simula un pago aprobado.</p>}
    </> : <p role="status">Procesando autorización de prueba…</p>}
  </section>;
}
export function RideReceipt({ ride }: { ride: RideRequest }) {
  const result = ride.settlement;
  if (!result) return null;
  const additionalPaid = ride.additionalPaymentApprovedAt ? ride.additionalPaymentConsentCents : 0;
  return <section className={styles.quote} aria-label="Recibo de prueba">
    <h3><CheckIcon aria-hidden="true" />Recibo de prueba · {ride.id.slice(-8)}</h3>
    <dl className={styles.moneyRows}>
      <div><dt>Costo final del proveedor</dt><dd>{money(ride.actualProviderCostCents)}</dd></div>
      <div><dt>Coordinación Recogido</dt><dd>{formatCents(ride.wasCancelled ? 0 : ride.pricing.coordinationFeeCents)}</dd></div>
      {ride.providerCancellationFeeCents > 0 && <div><dt>Cargo de cancelación</dt><dd>{formatCents(Math.min(ride.providerCancellationFeeCents, ride.authorizedAmountCents))}</dd></div>}
      <div className={styles.totalRow}><dt>Total final</dt><dd>{formatCents(result.finalCustomerTotalCents)}</dd></div>
      <div><dt>Total pagado (de prueba)</dt><dd>{formatCents(result.amountToCaptureCents + additionalPaid)}</dd></div>
      <div><dt>Retención y saldo liberados</dt><dd>{formatCents(result.amountToReleaseCents)}</dd></div>
      <div><dt>Estado del pago</dt><dd>{ride.paymentStatus === "additional_payment_required" ? "Importe adicional pendiente" : ride.paymentStatus === "released" ? "Sin cargo" : "Finalizado (de prueba)"}</dd></div>
    </dl>
    {ride.wasCancelled && <p>{ride.providerCancellationFeeCents ? "Cargo ficticio comunicado por el simulador, no confirmado por ningún proveedor real." : "Cancelación gratuita. No se cobra coordinación."}</p>}
    {result.additionalPaymentRequiredCents > 0 && !ride.additionalPaymentApprovedAt && <p>Faltan {formatCents(result.additionalPaymentRequiredCents)}. No habrá otro pago sin tu autorización expresa.</p>}
    <p>Recibo simulado dentro del navegador. No se envía ningún mensaje ni se mueve dinero real.</p>
  </section>;
}
const levels: Record<Indicator, string> = { green: "Objetivo cumplido", amber: "Necesita atención", red: "Modelo actualmente insuficiente" };
function Flag({ value }: { value: Indicator }) { return <strong className={styles.indicator} data-level={value}>{levels[value]}</strong>; }
function percent(value: number | null) { return value === null ? "Sin datos" : `${(value / 100).toFixed(1)}%`; }
function duration(value: number | null) { return value === null ? "Sin datos" : `${(value / 1000).toFixed(1)} s`; }
export function EconomicsMetrics({ requests }: { requests: RideRequest[] }) {
  const m = calculateRideMetrics(requests, new Date().toISOString());
  return <section className={`${styles.card} ${styles.metrics}`} aria-label="Métricas de supervisión">
    <h2>¿Es sostenible el 10%?</h2>
    <p>Volumen: {m.completedTrips} viajes · Promedio por viaje: {money(m.averageProviderEstimateCents)} · Automatización: {percent(m.automationBps)} · Margen contributivo: {formatCents(m.contributionCents)}.</p>
    <p>Estado general: <Flag value={m.overall} /></p>
    <p className={styles.muted}>Automático = web, sin intervención y pago finalizado. Denominador: todas las solicitudes de esta sesión, incluidas las pendientes. Meta ≥90%. Solo simulación, sin automatización externa real.</p>
    <dl className={styles.metricGrid}>
      <div><dt>Automatización (meta ≥90%)</dt><dd>{percent(m.automationBps)} <Flag value={m.indicators.automation} /></dd></div>
      <div><dt>Tarifa promedio proveedor (meta $25–$30)</dt><dd>{money(m.averageProviderEstimateCents)} <Flag value={m.indicators.provider} /></dd></div>
      <div><dt>Cerrado sin intervención (sobre finalizados)</dt><dd>{percent(m.closedWithoutInterventionBps)}</dd></div>
      <div><dt>Solicitudes con intervención humana</dt><dd>{percent(m.interventionBps)}</dd></div>
      <div><dt>Ingresos de coordinación</dt><dd>{formatCents(m.coordinationRevenueCents)}</dd></div>
      <div><dt>Costos estimados de procesamiento</dt><dd>{formatCents(m.estimatedProcessingFeesCents)}</dd></div>
      <div><dt>Margen contributivo (sin costos laborales ni fijos)</dt><dd>{formatCents(m.contributionCents)} <Flag value={m.indicators.contribution} /></dd></div>
      <div><dt>Cancelaciones</dt><dd>{percent(m.cancellationBps)}</dd></div>
      <div><dt>Reserva operativa sugerida (2% de pagos)</dt><dd>{formatCents(m.suggestedRiskReserveCents)}</dd></div>
      <div><dt>Viajes por día</dt><dd>{m.tripsPerDay.toFixed(2)}</dd></div>
      <div><dt>Excepciones registradas</dt><dd>{m.exceptionCount}</dd></div>
      <div><dt>Viajes bloqueados en needs_attention</dt><dd>{m.blockedCount}</dd></div>
      <div><dt>Promedio hasta reservar</dt><dd>{duration(m.averageBookingMs)}</dd></div>
      <div><dt>Promedio hasta conductor asignado</dt><dd>{duration(m.averageAssignmentMs)}</dd></div>
      <div><dt>Webhooks simulados duplicados ignorados</dt><dd>{m.duplicateEventsIgnored}</dd></div>
    </dl>
    <p className={styles.muted}>Reserva operativa sugerida; no representa fondos separados automáticamente.</p>
    <details><summary>Proyección mensual (30 días) y viajes por día</summary>
      <ul>{Object.entries(m.dailyCounts).map(([day, count]) => <li key={day}>{day}: {count} viajes</li>)}</ul>
      {([["Promedio actual", m.monthlyCurrent], ["100 viajes diarios", m.monthlyHundredDaily]] as const).map(([label, projection]) =>
        <p key={label}>{label}: {projection.trips} viajes · Coordinación {money(projection.coordinationRevenueCents)} · Procesamiento {money(projection.estimatedProcessingFeesCents)} · Contribución {money(projection.contributionCents)}</p>)}
      <p>Sin viajes finalizados no se proyectan importes. Escenario orientativo; excluye futuros reembolsos, disputas y costos fijos. Días calendario UTC desde la primera solicitud.</p>
    </details>
  </section>;
}
