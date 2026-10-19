export const driverOrderPattern = /^#[A-F0-9]{6}(?:-\d{2}|-B)?$/;
export const driverTokenKey = (slug: string) => `recogido:driver-token:${slug}`;
export type LiveStatus = "open" | "claimed" | "assigned" | "picked_up" | "completed" | "closed" | "declined" | "cancelled";
export interface LiveDriver {
  driverId: string;
  name: string;
  active: boolean;
  available: boolean;
  maxActiveDeliveries: number;
}
export interface LiveOrder {
  orderNumber: string;
  restaurantId: string;
  restaurantName: string;
  assignmentLabel: string;
  assignmentMode: "individual" | "batch";
  deliveryUnits: number;
  createdAt?: string;
  assignedAt?: string;
  pickedUpAt?: string;
  completedAt?: string;
  updatedAt?: string;
}
export interface LiveOffer extends LiveOrder {
  canAccept: boolean;
  blockReason?: string;
}
export interface LiveDelivery extends LiveOrder { status: LiveStatus }
export interface LiveConfig {
  success: true;
  driver: LiveDriver & { webEnabled: boolean };
}
export interface LiveDashboard {
  success: true;
  driver: LiveDriver;
  capacity: { used: number; maximum: number; remaining: number };
  offers: LiveOffer[];
  activeDeliveries: LiveDelivery[];
  history: LiveDelivery[];
}
export type DriverAction =
  | { action: "set_availability"; available: boolean }
  | { action: "accept" | "decline" | "pickup" | "complete"; orderNumber: string };
