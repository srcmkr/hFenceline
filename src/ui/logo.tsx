import type { TrayColor } from "@/core/app/overview";

export const TRAY_FILL: Record<TrayColor, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
};

export function Logo({ className, color = "green" }: { className?: string; color?: TrayColor }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path
        d="M32 4 8 12v18c0 15.5 10.2 26.3 24 30 13.8-3.7 24-14.5 24-30V12L32 4Z"
        fill={TRAY_FILL[color]}
      />
      <g fill="#fff">
        <path d="M20 26l3-4 3 4v18h-6z" />
        <path d="M29 22l3-4 3 4v24h-6z" />
        <path d="M38 26l3-4 3 4v18h-6z" />
        <rect x="17" y="29" width="30" height="3.5" rx="1" />
        <rect x="17" y="37" width="30" height="3.5" rx="1" />
      </g>
    </svg>
  );
}
