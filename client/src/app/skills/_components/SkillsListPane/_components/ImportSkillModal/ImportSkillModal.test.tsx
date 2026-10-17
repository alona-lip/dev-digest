import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
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
  useImportSkillPreview: () => ({ mutate: preview, isPending: false }),
  useCreateSkill: () => ({ mutate: create, isPending: false }),
}));

import { ImportSkillModal } from "./ImportSkillModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PREVIEW: SkillImportPreview = {
  name: "test-smells",
  description: "Use when tests mock the unit under test.",
  type: "rubric",
  body: "# Test smells\n- Do not mock the unit.",
  source_file: "pack.zip:pack/SKILL.md",
  ignored_files: [{ path: "pack/scripts/run.sh", reason: "executable" }],
  warnings: [],
  name_conflict: false,
};

const renderModal = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ImportSkillModal onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

const file = (name: string, content = "x") => new File([content], name);

async function pickFile(f: File) {
  await userEvent.upload(screen.getByTestId("skill-file-input"), f, { applyAccept: false });
}

describe("ImportSkillModal", () => {
  it("rejects a wrong file type before uploading anything", async () => {
    renderModal();
    await pickFile(file("evil.exe"));
    expect(screen.getByRole("alert")).toHaveTextContent("Only .md and .zip");
    expect(preview).not.toHaveBeenCalled();
  });

  it("rejects an oversized file before uploading", async () => {
    renderModal();
    await pickFile(new File([new Uint8Array(600 * 1024)], "big.zip"));
    expect(screen.getByRole("alert")).toHaveTextContent("larger than 512 KB");
    expect(preview).not.toHaveBeenCalled();
  });

  it("goes file → PREVIEW; nothing is created until Save is confirmed", async () => {
    preview.mockImplementation((_req, opts) => opts.onSuccess(PREVIEW));
    renderModal();
    await pickFile(file("pack.zip", "zipbytes"));
    await waitFor(() => expect(screen.getByText("Import skill — preview")).toBeInTheDocument());

    // trust warning + the ignored executable are shown; nothing saved yet
    expect(screen.getByRole("note")).toHaveTextContent("foreign instructions");
    expect(screen.getByText("pack/scripts/run.sh")).toBeInTheDocument();
    expect(screen.getByText("executable")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(preview.mock.calls[0]![0]).toMatchObject({ filename: "pack.zip", content_base64: expect.any(String) });

    await userEvent.click(screen.getByRole("button", { name: /Save skill/ }));
    expect(create.mock.calls[0]![0]).toEqual({
      name: "test-smells",
      description: "Use when tests mock the unit under test.",
      type: "rubric",
      body: PREVIEW.body,
      source: "imported_file",
    });
  });

  it("blocks Save while the name clashes, until it is renamed", async () => {
    preview.mockImplementation((_req, opts) => opts.onSuccess({ ...PREVIEW, name_conflict: true }));
    renderModal();
    await pickFile(file("pack.zip"));
    await waitFor(() => screen.getByText("Import skill — preview"));
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeDisabled();

    const nameInput = screen.getAllByRole("textbox")[0]!;
    await userEvent.type(nameInput, "-2");
    expect(screen.queryByText(/already exists/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeEnabled();
  });

  // The error is set after the file is read asynchronously (FileReader), so these wait for it.
  it("shows the server's message when the API rejects the file", async () => {
    preview.mockImplementation((_req, opts) =>
      opts.onError(new ApiError("No SKILL.md found at the archive root", 422, "validation_error")),
    );
    renderModal();
    await pickFile(file("a.md"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No SKILL.md found at the archive root");
  });

  it("shows a generic message when the failure is not an API error", async () => {
    preview.mockImplementation((_req, opts) => opts.onError(new Error("boom")));
    renderModal();
    await pickFile(file("a.md"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not read this file.");
    expect(alert).not.toHaveTextContent("boom"); // internals are not leaked to the user
  });
});
