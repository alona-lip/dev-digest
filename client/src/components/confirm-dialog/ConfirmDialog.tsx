/* ConfirmDialog — a small confirmation modal for destructive actions (delete a
   skill, delete an agent). Close (X), Cancel, Esc and a backdrop click all cancel;
   only the confirm button runs `onConfirm`. Texts come from the caller's namespace,
   the button labels default to `common.actions.*`.
   Focus (the kit Modal does none of this): Cancel is focused on open — the safe
   default for a destructive action — Tab / Shift+Tab cycle inside the dialog, and
   focus goes back to whatever opened it when it closes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { focusableIn } from "./helpers";
import { s } from "./styles";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = true,
  pending = false,
  onConfirm,
  onClose,
}: {
  title: React.ReactNode;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** The confirmed action is running: the confirm button is disabled. */
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("common");
  const footerRef = React.useRef<HTMLDivElement>(null);

  // Move focus into the dialog on open; give it back to the opener on close.
  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Cancel is the first button of the footer.
    footerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => opener?.focus();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const dialog = footerRef.current?.closest<HTMLElement>('[role="dialog"]');
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
  }, [onClose]);

  return (
    <Modal
      width={440}
      title={title}
      onClose={onClose}
      footer={
        <div ref={footerRef} style={s.footer}>
          <Button kind="secondary" onClick={onClose}>
            {t("actions.cancel")}
          </Button>
          <Button
            kind={danger ? "danger" : "primary"}
            icon={danger ? "Trash" : "Check"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? t("actions.deleting") : (confirmLabel ?? t("actions.delete"))}
          </Button>
        </div>
      }
    >
      {body && <div style={s.body}>{body}</div>}
    </Modal>
  );
}
