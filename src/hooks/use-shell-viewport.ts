"use client";

import { useSyncExternalStore } from "react";

/**
 * Which app shell is on screen. Pages render both MobileShell and
 * DashboardShell and CSS hides one; without this, every page component (and
 * its data fetching) would mount twice. Each shell renders its children only
 * when it is the active one.
 *
 * Must match the CSS in globals.css: `md:` (768px) switches to the dashboard,
 * except phones in landscape (height < 600px) keep the mobile shell.
 */
const DESKTOP_QUERY = "(min-width: 768px) and (min-height: 600px)";

export type ShellViewport = "mobile" | "desktop";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): ShellViewport {
  if (typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia(DESKTOP_QUERY).matches ? "desktop" : "mobile";
}

/** `null` during server render and hydration, before the viewport is known. */
function getServerSnapshot(): ShellViewport | null {
  return null;
}

export function useShellViewport(): ShellViewport | null {
  return useSyncExternalStore<ShellViewport | null>(subscribe, getSnapshot, getServerSnapshot);
}
