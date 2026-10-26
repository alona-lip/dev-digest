/* ConfirmDialog — a small confirmation modal for destructive actions (delete a
   skill, delete an agent). Close (X), Cancel, Esc and a backdrop click all cancel;
   only the confirm button runs `onConfirm`. Texts come from the caller's namespace,
   the button labels default to `common.actions.*`.
   Focus (`useDialogFocus`; the kit Modal does none of this): Cancel is focused on open —
   the safe default for a destructive action — Tab / Shift+Tab cycle inside the dialog, and
   focus goes back to whatever opened it when it closes. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal } from "@devdigest/ui";
import { useDialogFocus } from "@/lib/dialog-focus";
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

  // Cancel is the first button of the footer, so the footer is the initial-focus scope.
  useDialogFocus(footerRef, onClose, "anchor");

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
