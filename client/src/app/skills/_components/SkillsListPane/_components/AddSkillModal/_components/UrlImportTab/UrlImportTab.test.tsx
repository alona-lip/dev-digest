import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import messages from "@messages/en/skills.json";
import { ApiError } from "@/lib/api";
import { ToastProvider } from "@/lib/toast";

const push = vi.fn();
const preview = vi.fn();
const create = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/hooks/skills", () => ({
  useImportSkillUrlPreview: () => ({ mutate: preview, isPending: false }),
  useCreateSkill: () => ({ mutate: create, isPending: false }),
}));

import { UrlImportTab } from "./UrlImportTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const URL_ = "https://raw.githubusercontent.com/acme/skills/main/sec/SKILL.md";
const PREVIEW: SkillImportPreview = {
  name: "secret-leakage",
  description: "Use when a diff adds a credential.",
  type: "security",
  body: "# Secrets\n- Flag hardcoded keys.",
  source_file: URL_,
  ignored_files: [],
  warnings: [],
  name_conflict: false,
  scan: { status: "clean", method: "pattern", findings: [], scanned_at: null },
};

const renderTab = (onDone = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <UrlImportTab onDone={onDone} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
  return onDone;
};

describe("UrlImportTab", () => {
  it("Fetch stays disabled until a URL is typed; Enter submits it", async () => {
    renderTab();
    expect(screen.getByText("Fetched server-side, stored as untrusted, and left disabled until vetted.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fetch" })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("https://example.com/skills/security.md"), ` ${URL_}{Enter}`);
    expect(preview.mock.calls[0]![0]).toEqual({ url: URL_ });
  });

  it("goes URL → PREVIEW → saves an imported_url skill, DISABLED until vetted", async () => {
    preview.mockImplementation((_req, opts) => opts.onSuccess(PREVIEW));
    create.mockImplementation((_input, opts) => opts.onSuccess({ id: "u1", name: PREVIEW.name, scan: PREVIEW.scan }));
    const onDone = renderTab();
    await userEvent.type(screen.getByRole("textbox"), URL_);
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));

    expect(screen.getByText(`Source: ${URL_}`)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save skill" }));
    expect(create.mock.calls[0]![0]).toEqual({
      name: "secret-leakage",
      description: "Use when a diff adds a credential.",
      type: "security",
      body: PREVIEW.body,
      source: "imported_url",
      enabled: false,
    });
    expect(onDone).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/u1");
    expect(await screen.findByText(/Disabled until you vet/)).toBeInTheDocument();
  });

  it("shows the server's message when the fetch is refused, and a generic one otherwise", async () => {
    preview.mockImplementationOnce((_req, opts) =>
      opts.onError(new ApiError("That address is not allowed (local or private network)", 422, "validation_error")),
    );
    renderTab();
    await userEvent.type(screen.getByRole("textbox"), "https://localhost/x.md");
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(screen.getByRole("alert")).toHaveTextContent("not allowed (local or private network)");

    preview.mockImplementationOnce((_req, opts) => opts.onError(new Error("socket hang up")));
    await userEvent.click(screen.getByRole("button", { name: "Fetch" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Could not fetch this URL.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("socket");
  });
});
