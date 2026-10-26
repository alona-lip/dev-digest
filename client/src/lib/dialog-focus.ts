/* dialog-focus.ts — focus handling for a kit `Modal` (the kit Modal does none): focus moves
   into the dialog on open, Tab / Shift+Tab cycle inside it, Escape closes it, and focus goes
   back to whatever opened it on close. Shared by ConfirmDialog and the Blast radius graph modal. */
"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Elements Tab can reach inside `root`, in DOM order (disabled controls are skipped). */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * `anchorRef` is any element rendered inside the dialog; the dialog is its closest
 * `[role="dialog"]`. On open the first focusable control gets focus — the first in the
 * whole dialog (`initial: "dialog"`, e.g. the ✕) or the first inside the anchor
 * (`initial: "anchor"`, e.g. ConfirmDialog's Cancel).
 */
export function useDialogFocus(
  anchorRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initial: "dialog" | "anchor" = "dialog",
): void {
  // Move focus in on open, give it back to the opener on close. Runs once: a new
  // `onClose` identity must not re-focus.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const anchor = anchorRef.current;
    const scope = initial === "anchor" ? anchor : anchor?.closest<HTMLElement>('[role="dialog"]');
    if (scope) focusableIn(scope)[0]?.focus();
    return () => opener?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const dialog = anchorRef.current?.closest<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      const items = focusableIn(dialog);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const inside = dialog.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anchorRef, onClose]);
}
