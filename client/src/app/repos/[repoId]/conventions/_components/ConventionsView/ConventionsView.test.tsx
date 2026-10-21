import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/conventions.json";
import type { ConventionCandidate, ExtractConventionsResult } from "@devdigest/shared";

const extract = vi.fn();
const update = vi.fn();
const bulk = vi.fn();
const refetch = vi.fn();
let LIST: ConventionCandidate[] | undefined;
let LIST_STATE = { isLoading: false, isError: false };
let EXTRACT_DATA: ExtractConventionsResult | undefined;

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repos: [{ id: "r1", name: "payments-api" }] }),
  useRepoNotFound: () => false,
}));
vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({ data: LIST, ...LIST_STATE, refetch }),
  useExtractConventions: () => ({ mutate: extract, isPending: false, data: EXTRACT_DATA }),
  useUpdateConvention: () => ({ mutate: update }),
  useBulkConventionStatus: () => ({ mutate: bulk, isPending: false }),
}));
vi.mock("../CreateSkillFromConventionsModal", () => ({
  CreateSkillFromConventionsModal: ({ repoName }: { repoName: string }) => <div>modal for {repoName}</div>,
}));

import { ConventionsView } from "./ConventionsView";

const c = (id: string, status: ConventionCandidate["status"], rule = `Rule ${id}`): ConventionCandidate => ({
  id,
  repo_id: "r1",
  category: "NAMING",
  rule,
  evidence_path: "src/a.ts",
  evidence_start_line: 1,
  evidence_end_line: 2,
  evidence_snippet: "export const a = 1;",
  confidence: 0.8,
  status,
  created_at: "2026-10-19T00:00:00.000Z",
});

beforeEach(() => {
  LIST = [];
  LIST_STATE = { isLoading: false, isError: false };
  EXTRACT_DATA = undefined;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderView = () =>
  render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView repoId="r1" />
    </NextIntlClientProvider>,
  );

describe("ConventionsView", () => {
  it("first visit: an empty state with Run Scan, no Re-scan and no Create skill", async () => {
    renderView();
    expect(screen.getByRole("heading", { name: "Conventions in payments-api" })).toBeInTheDocument();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-scan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create skill/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Run Scan/ }));
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("while the list loads: a busy skeleton, no empty state and no Run Scan", () => {
    LIST = undefined;
    LIST_STATE = { isLoading: true, isError: false };
    const { container } = renderView();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText("No conventions extracted yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Scan/ })).not.toBeInTheDocument();
  });

  it("a failed list load shows the error, and Retry refetches it", async () => {
    LIST = undefined;
    LIST_STATE = { isLoading: false, isError: true };
    renderView();
    expect(screen.getByText("Could not load conventions.")).toBeInTheDocument();
    expect(screen.queryByText("No conventions extracted yet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("with candidates: one card each, Re-scan in the header, the accepted count and Create skill", async () => {
    LIST = [c("1", "ACCEPTED"), c("2", "PENDING")];
    renderView();
    expect(screen.getAllByTestId("convention-card")).toHaveLength(2);
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run Scan/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Re-scan/ }));
    expect(extract).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: /Create skill/ }));
    expect(screen.getByText("modal for payments-api")).toBeInTheDocument();
  });

  it("right after a scan (all pending) there is no Create skill until one is accepted", () => {
    LIST = [c("1", "PENDING"), c("2", "PENDING")];
    renderView();
    expect(screen.queryByRole("button", { name: /Create skill/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deselect all/ })).toBeDisabled();
  });

  it("Deselect all sets every accepted candidate back to pending in one request", async () => {
    LIST = [c("1", "ACCEPTED"), c("2", "PENDING"), c("3", "ACCEPTED")];
    renderView();
    await userEvent.click(screen.getByRole("button", { name: /Deselect all/ }));
    expect(bulk).toHaveBeenCalledWith({ ids: ["1", "3"], status: "PENDING" });
  });

  it("a card's Reject goes to the update mutation for that candidate", async () => {
    LIST = [c("1", "ACCEPTED")];
    renderView();
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(update).toHaveBeenCalledWith({ id: "1", patch: { status: "REJECTED" } });
  });

  it("after a scan, the subtitle reports what the evidence gate kept and dropped", () => {
    LIST = [c("1", "ACCEPTED")];
    EXTRACT_DATA = {
      candidates: LIST,
      stats: { sampled_files: 14, proposed: 5, dropped_ungrounded: 2, dropped_duplicate: 1 },
      model: "gpt-4o-mini",
      cost_usd: 0.001,
    };
    renderView();
    expect(
      screen.getByText("Detected from 14 sample files · 5 proposed · 2 dropped without evidence · 1 already listed"),
    ).toBeInTheDocument();
  });
});
