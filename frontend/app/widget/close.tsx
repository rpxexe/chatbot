"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// The launcher lives on the page around this frame (public/widget.js, or the dashboard's Customize preview): ask it to
// close the panel.
const close = () => window.parent.postMessage({ type: "chatbot:close" }, "*");

export function CloseWidget() {
  // Opened on its own (not framed) there is nothing to close into, so no button.
  const [framed, setFramed] = useState(false);
  useEffect(() => {
    if (window.parent === window) return;
    setFramed(true);
    // Escape anywhere in the panel closes it, unless it is ending an IME composition or a control (a tooltip) used it.
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.isComposing && !e.defaultPrevented && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (!framed) return null;
  return (
    <Button variant="ghost" size="icon" aria-label="Close chat" onClick={close}>
      <X aria-hidden="true" />
    </Button>
  );
}

/**
 * Copies the panel's forced theme and colors onto <html>, so popups that render outside the panel (tooltips portal to
 * <body>) match it too.
 */
export function RootTheme({ theme, vars }: { theme?: string; vars?: Record<string, string> }) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    for (const [k, v] of Object.entries(vars ?? {})) root.style.setProperty(k, v);
    return () => {
      delete root.dataset.theme;
      for (const k of Object.keys(vars ?? {})) root.style.removeProperty(k);
    };
  }, [theme, vars]);
  return null;
}
