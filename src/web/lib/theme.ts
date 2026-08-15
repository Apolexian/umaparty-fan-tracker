import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  return media.matches ? "dark" : "light";
}

function stored(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

function apply(theme: Theme | null) {
  if (theme) {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

apply(stored());
media.addEventListener("change", () => {
  if (!stored()) listeners.forEach((l) => l());
});

export function getTheme(): Theme {
  return stored() ?? systemTheme();
}

export function setTheme(theme: Theme) {
  localStorage.setItem(STORAGE_KEY, theme);
  apply(theme);
  listeners.forEach((l) => l());
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders whenever the resolved theme changes, from the toggle or the OS. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}
