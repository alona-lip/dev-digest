import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextDoc, ContextDocList } from "@devdigest/shared";
import messages from "@messages/en/context.json";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/repo-not-found", () => ({ RepoNotFound: () => <div>repo not found</div> }));
vi.mock("@/lib/repo-context", () => ({ useRepoNotFound: () => false }));

import { ProjectContextView } from "./ProjectContextView";

const doc = (path: string, type: ContextDoc["type"], tokens: number | null = 100): ContextDoc => ({
  path,
  type,
  size_bytes: 10,
  tokens,
  too_large: false,
});

const DOCS = [
  doc("specs/auth.md", "specs", 100),
  doc("docs/public-api.md", "docs", 250),
  doc("docs/Guide.md", "docs", 50),
  doc("notes/learned.md", "insights", 0),
];

let list: () => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let listCalls: number;

const okList = (over: Partial<ContextDocList> = {}) => ({
  status: 200,
  body: {
    status: "ok",
    glob: "**/*.md",
    truncated: false,
    read_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    docs: DOCS,
    ...over,
  },
});

beforeEach(() => {
  listCalls = 0;
  list = () => okList();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (url.includes("/context/usage"))
        return json({ repo_id: "r1", by_path: { "docs/public-api.md": { agents: 3, skills: 2 } } });
      if (url.includes("/context/file"))
        return json({ path: "docs/public-api.md", type: "docs", content: "# Public API heading\n\nbody", tokens: 250 });
      if (url.includes("/repos/r1/context")) {
        listCalls++;
        const r = await list();
        return json(r.body, r.status);
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderView = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ProjectContextView repoId="r1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};

describe("ProjectContextView", () => {
  it("AC-9: documents are grouped by type with their paths", async () => {
    renderView();
    expect(await screen.findByText("specs/auth.md")).toBeInTheDocument();
    for (const g of ["specs", "docs", "insights"]) {
      expect(screen.getByRole("region", { name: g })).toBeInTheDocument();
    }
    expect(screen.getByText("docs/public-api.md")).toBeInTheDocument();
    expect(screen.getByText("notes/learned.md")).toBeInTheDocument();
  });

  it("AC-10: the filter keeps matching paths, case-insensitively", async () => {
    renderView();
    await screen.findByText("specs/auth.md");
    await userEvent.type(screen.getByRole("searchbox"), "API");
    expect(screen.getByText("docs/public-api.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/auth.md")).not.toBeInTheDocument();
    expect(screen.queryByText("docs/Guide.md")).not.toBeInTheDocument();
  });

  it("AC-11 and AC-12: selecting a document renders its markdown and shows its usage counters", async () => {
    renderView();
    expect(screen.queryByText(/Used by/)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "docs/public-api.md" }));
    expect(await screen.findByRole("heading", { name: "Public API heading" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Used by 3 agents · 2 skills")).toBeInTheDocument());
  });

  it("AC-13: refresh requests the list again and renders the new list", async () => {
    renderView();
    await screen.findByText("specs/auth.md");
    expect(listCalls).toBe(1);
    list = () => okList({ docs: [...DOCS, doc("docs/new-file.md", "docs", 0)] });
    await userEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    expect(await screen.findByText("docs/new-file.md")).toBeInTheDocument();
    expect(listCalls).toBe(2);
  });

  it("AC-14: a skeleton is visible while the list loads", async () => {
    list = () => new Promise(() => {});
    const { container } = renderView();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText("specs/auth.md")).not.toBeInTheDocument();
  });

  it("AC-15: an empty list shows an empty state naming the glob", async () => {
    list = () => okList({ docs: [], glob: "docs/**/*.md" });
    renderView();
    expect(await screen.findByText(/docs\/\*\*\/\*\.md/)).toBeInTheDocument();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
  });

  it("AC-16: not_cloned shows its own state, not the empty one", async () => {
    list = () => okList({ status: "not_cloned", docs: [] });
    renderView();
    expect(await screen.findByText("Repository not cloned yet")).toBeInTheDocument();
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
  });

  it("AC-17: a failed load shows an error and Retry requests the list again", async () => {
    list = () => ({ status: 500, body: { error: { code: "boom", message: "boom" } } });
    renderView();
    expect(await screen.findByText("Couldn’t load the documents")).toBeInTheDocument();
    const before = listCalls;
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });

  it("AC-18: a truncated list shows the notice", async () => {
    list = () => okList({ truncated: true });
    renderView();
    expect(await screen.findByText("Only the first 500 documents are listed.")).toBeInTheDocument();
  });

  it("AC-19: no create, upload, edit or delete control", async () => {
    renderView();
    await screen.findByText("specs/auth.md");
    expect(screen.queryByRole("button", { name: /create|new|upload|edit|delete|remove/i })).not.toBeInTheDocument();
  });

  it("AC-20: the summary shows count, token sum and relative time; no indexed/chunks wording", async () => {
    const { container } = renderView();
    expect(await screen.findByText("4 documents · ≈ 400 tokens · refreshed 5 minutes ago")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/indexed|chunks/i);
  });
});
