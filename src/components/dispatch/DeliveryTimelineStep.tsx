import type { TimelineStep } from "@/lib/dispatch/delivery-progress";
import { formatClock } from "@/lib/dispatch/dispatch-queue";
import { DeliveryIcon, type DeliveryIconName } from "./DeliveryIcon";
import styles from "./DispatchTerminal.module.css";

const stepIcon: Record<TimelineStep["key"], DeliveryIconName> = {
  received: "flag",
  assigned: "driver",
  picked_up: "bag",
  completed: "check",
};

const stateText: Record<TimelineStep["state"], string> = {
  complete: "completado",
  current: "en curso",
  pending: "pendiente",
  cancelled: "cancelado",
};

function safeClock(value: string) {
  return Number.isFinite(Date.parse(value)) ? formatClock(value) : null;
}

export function DeliveryTimelineStep({ step }: { step: TimelineStep }) {
  const icon: DeliveryIconName = step.state === "complete" ? "check" : step.state === "cancelled" ? "x" : stepIcon[step.key];
  const clock = step.time ? safeClock(step.time) : null;
  return (
    <li className={styles.timelineStep} data-state={step.state} data-step={step.key}
      aria-current={step.state === "current" ? "step" : undefined}>
      <span className={styles.timelineMarker}><DeliveryIcon name={icon} /></span>
      <span className={styles.timelineText}>
        <span className={styles.timelineLabel}>{step.label}</span>
        <span className={styles.visuallyHidden}>: {stateText[step.state]}</span>
        {step.detail && <span className={styles.timelineDetail}>{step.detail}</span>}
        {clock && step.time && <time className={styles.timelineTime} dateTime={step.time}>{clock}</time>}
      </span>
    </li>
  );
}
