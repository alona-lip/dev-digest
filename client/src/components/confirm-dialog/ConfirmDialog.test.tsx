import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/common.json";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

const renderDialog = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <ConfirmDialog
        title='Delete skill "test-smells"?'
        body="It is unlinked from every agent."
        onConfirm={onConfirm}
        onClose={onClose}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onConfirm, onClose };
};

describe("ConfirmDialog", () => {
  it("shows the title and body in a dialog", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText('Delete skill "test-smells"?')).toBeTruthy();
    expect(screen.getByText("It is unlinked from every agent.")).toBeTruthy();
  });

  it("runs onConfirm only from the confirm button", async () => {
    const { onConfirm, onClose } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("cancels with Cancel, the close (X) button and Esc", async () => {
    const { onConfirm, onClose } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables the confirm button while the action is pending", () => {
    renderDialog({ pending: true });
    expect((screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("focuses Cancel on open (the safe default for a destructive action)", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("keeps Tab inside the dialog: Cancel → Delete → wraps to Close, Shift+Tab goes back", async () => {
    renderDialog();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
  });

  it("gives focus back to the button that opened it", async () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <NextIntlClientProvider locale="en" messages={{ common: messages }}>
          <button onClick={() => setOpen(true)}>Delete alpha</button>
          {open && <ConfirmDialog title="Delete?" onConfirm={vi.fn()} onClose={() => setOpen(false)} />}
        </NextIntlClientProvider>
      );
    }
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Delete alpha" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete alpha" })).toHaveFocus();
  });
});
