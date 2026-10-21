import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/conventions.json";
import { EvidenceBlock } from "./EvidenceBlock";
import { COPY_FEEDBACK_MS } from "./constants";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SNIPPET = "const user = await db.users.find(id);\nconst posts = await db.posts.findMany({ userId });";

function renderBlock(startLine: number, endLine: number) {
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <EvidenceBlock path="src/api/users.ts" startLine={startLine} endLine={endLine} snippet={SNIPPET} />
    </NextIntlClientProvider>,
  );
}

describe("EvidenceBlock", () => {
  it("shows file:range for a multi-line citation and file:line for a one-line one", () => {
    renderBlock(23, 31);
    expect(screen.getByText("src/api/users.ts:23-31")).toBeInTheDocument();
    cleanup();
    renderBlock(7, 7);
    expect(screen.getByText("src/api/users.ts:7")).toBeInTheDocument();
  });

  it("Copy puts the snippet on the clipboard, confirms, then resets", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    // userEvent.setup() installs its own clipboard stub — spy on it after setup.
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderBlock(23, 31);

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith(SNIPPET);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(COPY_FEEDBACK_MS);
    });
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });
});
