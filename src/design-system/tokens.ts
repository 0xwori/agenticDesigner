export const colors = {
  canvas: "#faf8f6",
  surface: "#fefdfd",
  surfaceMuted: "#f4f0eb",
  surfaceTint: "#efebe6",
  line: "#e4e4e7",
  lineSoft: "rgba(228,228,231,0.7)",
  ink: "#171b26",
  inkMuted: "#555b6d",
  inkSubtle: "#6b7280",
  accent: "#fd6522",
  accentSoft: "rgba(253,101,34,0.1)",
  accentLine: "rgba(253,101,34,0.28)",
  successBg: "#dbf6ea",
  successText: "#157956"
} as const;

export const radii = {
  sm: "10px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  pill: "999px"
} as const;

export const shadows = {
  card: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.1)",
  soft: "0 1px 2px rgba(15, 23, 42, 0.06)"
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32
} as const;

export const typography = {
  family: "Geist, Geist Sans, ui-sans-serif, -apple-system, Segoe UI, sans-serif",
  headingLg: "700 36px/1.2 Geist, Geist Sans, ui-sans-serif, -apple-system, Segoe UI, sans-serif",
  headingMd: "600 24px/1.3 Geist, Geist Sans, ui-sans-serif, -apple-system, Segoe UI, sans-serif",
  body: "400 14px/1.45 Geist, Geist Sans, ui-sans-serif, -apple-system, Segoe UI, sans-serif",
  bodyStrong: "600 14px/1.45 Geist, Geist Sans, ui-sans-serif, -apple-system, Segoe UI, sans-serif"
} as const;
