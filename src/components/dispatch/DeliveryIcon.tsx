export type DeliveryIconName = "check" | "search" | "driver" | "bag" | "truck" | "flag" | "x" | "alert";

const paths: Record<DeliveryIconName, string> = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16l-4-4",
  driver: "M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5",
  bag: "M6 8h12l-1 12H7L6 8zm3 0V6a3 3 0 0 1 6 0v2",
  truck: "M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  x: "M6 6l12 12M18 6L6 18",
  alert: "M12 4l9 16H3L12 4zm0 6v4m0 3v.5",
};

/** Small inline icon (no external dependency). Always decorative: the text next to it carries the meaning. */
export function DeliveryIcon({ name, className }: { name: DeliveryIconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name]} />
    </svg>
  );
}
