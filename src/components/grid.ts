"use client";

import { AllCommunityModule, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz } from "ag-grid-community";

// AG Grid Community (MIT). Registering all community modules once for every grid in the app.
ModuleRegistry.registerModules([AllCommunityModule]);

const base = {
  accentColor: "#b4532a",
  fontFamily: "inherit",
  headerFontWeight: 600,
  fontSize: 13,
  rowVerticalPaddingScale: 0.9,
  wrapperBorderRadius: 10,
};

export const lightTheme = themeQuartz.withPart(colorSchemeLight).withParams({ ...base, backgroundColor: "#ffffff", oddRowBackgroundColor: "#faf9f6" });
export const darkTheme = themeQuartz.withPart(colorSchemeDark).withParams({ ...base, backgroundColor: "#171a21", oddRowBackgroundColor: "#191d25", borderColor: "#2a2f3a" });

export function useGridTheme() {
  if (typeof window === "undefined") return lightTheme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? darkTheme : lightTheme;
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "" : `${Math.round(v * 100)}%`);
export const usd = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v));
