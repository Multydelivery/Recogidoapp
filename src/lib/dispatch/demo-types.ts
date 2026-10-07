export type DemoStatus =
  | "idle"
  | "submitting"
  | "searching"
  | "assigned"
  | "cancelled"
  | "error";

export interface DemoRequest {
  requestId: string;
  deliveryCount: number;
  status: DemoStatus;
  driverName?: string;
  createdAt: string;
}

export const demoStatusLabels: Record<DemoStatus, string> = {
  idle: "Sin enviar",
  submitting: "Enviando",
  searching: "Buscando conductor",
  assigned: "Conductor asignado",
  cancelled: "Solicitud cancelada",
  error: "Error",
};

export function formatDemoTime(date: string) {
  return new Intl.DateTimeFormat("es", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}
