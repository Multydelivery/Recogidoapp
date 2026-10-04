import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function PhoneIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5c0-.55.45-1 1-1h2.3c.46 0 .87.32.97.77l.8 3.6a1 1 0 0 1-.28.95L7.4 10.7a12.5 12.5 0 0 0 5.9 5.9l1.38-1.39a1 1 0 0 1 .95-.28l3.6.8c.45.1.77.51.77.97V19c0 .55-.45 1-1 1h-1.5C9.6 20 4 14.4 4 6.5V5Z" />
    </svg>
  );
}

export function RestaurantIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M7 3v7a2 2 0 0 0 2 2v9" />
      <path d="M7 3v5M10 3v5" />
      <path d="M17 3c-1.5 0-2.5 1.6-2.5 4s1 4 2.5 4v10" />
    </svg>
  );
}

export function MessageIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9A1.5 1.5 0 0 1 18.5 16H9l-4 4v-4H5.5A1.5 1.5 0 0 1 4 14.5v-9Z" />
    </svg>
  );
}

export function DispatchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4" />
      <path d="M5.3 5.3a9.2 9.2 0 0 0 0 13.4M18.7 5.3a9.2 9.2 0 0 1 0 13.4" />
    </svg>
  );
}

export function CarIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 16v-3.2a2 2 0 0 1 .3-1L6 8.4A2 2 0 0 1 7.8 7h8.4a2 2 0 0 1 1.8 1.4l1.7 3.4a2 2 0 0 1 .3 1V16" />
      <path d="M3 16h18v2a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-11v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2Z" />
      <circle cx="7.5" cy="16" r="1.4" />
      <circle cx="16.5" cy="16" r="1.4" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-11Z" />
      <path d="m4.5 6.5 7.5 6 7.5-6" />
    </svg>
  );
}
