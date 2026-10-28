/**
 * Small inline SVG icons (stroke-based, 16–18px) so the project needs no icon
 * dependency. All are decorative and marked aria-hidden.
 */
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
}

const svg = (size: number | undefined, children: ReactNode) => (
  <svg
    width={size ?? 16}
    height={size ?? 16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export function SunIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>
  ));
}

export function MoonIcon({ size }: IconProps) {
  return svg(size, <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
}

export function PlusIcon({ size }: IconProps) {
  return svg(size, <path d="M12 5v14M5 12h14" />);
}

export function XIcon({ size }: IconProps) {
  return svg(size, <path d="M18 6 6 18M6 6l12 12" />);
}

export function SearchIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </>
  ));
}

export function RefreshIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </>
  ));
}

export function CheckIcon({ size }: IconProps) {
  return svg(size, <path d="M20 6 9 17l-5-5" />);
}

export function AlertIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ));
}

export function TrashIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
    </>
  ));
}

export function BoxIcon({ size }: IconProps) {
  return svg(size, (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ));
}
