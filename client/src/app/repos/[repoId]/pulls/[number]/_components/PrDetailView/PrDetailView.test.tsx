/** PrDetailView — real hooks + QueryClient; only `fetch`, `next/navigation`, the app shell and
    the repo context are faked. The router mock keeps the URL, so a `replace` re-renders the page. */
import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import brief from "@messages/en/brief.json";
import blast from "@messages/en/blast.json";
import prReview from "@messages/en/prReview.json";
import shell from "@messages/en/shell.json";
import { PrDetailView } from "./PrDetailView";

let query = "";
const replace = vi.fn();
const scroll = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
  usePathname: () => "/repos/r/pulls/7",
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "r", full_name: "a/b" }, repos: [], reposLoaded: true }),
  useRepoNotFound: () => false,
}));

const patch = (start: number) => `@@ -1,1 +${start},2 @@\n ctx line\n+added line`;
const PR = {
  id: "pr-1", number: 7, title: "T", author: "u", branch: "b", base: "main", head_sha: "abc",
  additions: 2, deletions: 0, files_count: 2, status: "open", body: "Body text", commits: [],
  files: [
    { path: "src/a.ts", additions: 1, deletions: 0, patch: patch(24) },
    { path: "src/b.ts", additions: 1, deletions: 0, patch: patch(5) },
  ],
};
const READY = {
  status: "ready",
  stale: false,
  current_head_sha: "abc",
  brief: {
    pr_id: "pr-1", head_sha: "abc", generated_at: "2026-10-01T00:00:00Z", model: "m", summary: "S",
    risks: [{ kind: "security", title: "Bypass risk", explanation: "x", severity: "high", file_refs: ["src/a.ts:12-18"] }],
    review_focus: [
      { file: "src/a.ts", line: 25, reason: "start here" },
      { file: "src/caller.ts", line: 3, reason: "caller side" },
    ],
    missing_inputs: [], trimmed_inputs: [], dropped: { risks: 0, review_focus: 0 },
    input_tokens: 1, cost_usd: null,
  },
};

function stubApi() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (u.endsWith("/brief")) return init?.method === "POST" ? json({}, 500) : json(READY);
      if (u.endsWith("/repos/r/pulls")) return json([PR]);
      if (u.endsWith("/pulls/pr-1")) return json(PR);
      if (u.includes("/intent")) return json({ message: "boom" }, 500);
      if (u.includes("/comments")) return json([]);
      if (u.includes("/reviews") || u.includes("/runs") || u.includes("/agents")) return json([]);
      return json({}, 404);
    }),
  );
}

function ui(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief, blast, prReview, shell }}>
        <PrDetailView repoId="r" number="7" />
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

function renderView(initial = "") {
  query = initial;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(ui(qc));
  return { rerender: () => utils.rerender(ui(qc)) };
}

beforeEach(() => {
  replace.mockReset();
  replace.mockImplementation((url: string) => {
    query = url.split("?")[1] ?? "";
  });
  scroll.mockClear();
  Element.prototype.scrollIntoView = scroll;
  stubApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PrDetailView deep links", () => {
  it("AC-57: a focus item opens the Diff tab on that file and line, then scrolls to it", async () => {
    const user = userEvent.setup();
    const { rerender } = renderView();
    await user.click(await screen.findByRole("button", { name: "Open src/a.ts:25" }));
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("/repos/r/pulls/7?tab=diff&file=src%2Fa.ts&line=25");

    rerender();
    expect(await screen.findByText("Linked line")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /src\/a\.ts/ })).toHaveAttribute("aria-expanded", "true");
    expect(scroll).toHaveBeenCalled();
  });

  it("AC-59: a risk ref with a line range navigates to its first line", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: "Show details" }));
    await user.click(await screen.findByRole("button", { name: /src\/a\.ts:12/ }));
    expect(replace).toHaveBeenCalledWith("/repos/r/pulls/7?tab=diff&file=src%2Fa.ts&line=12");
  });

  it("AC-60: a file outside the diff shows a message, does not navigate", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByRole("button", { name: "Open src/caller.ts:3" }));
    expect(await screen.findByText("File not in this PR's diff")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("AC-61: an unknown file in the initial URL renders the diff without error", async () => {
    renderView("tab=diff&file=unknown.ts&line=3");
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByText("Linked line")).not.toBeInTheDocument();
    expect(scroll).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("AC-57: switching tabs by hand drops file and line but keeps other params", async () => {
    const user = userEvent.setup();
    renderView("tab=diff&file=src%2Fa.ts&line=25&severity=CRITICAL");
    await user.click(await screen.findByRole("button", { name: /^Overview/ }));
    expect(replace).toHaveBeenCalledWith("/repos/r/pulls/7?tab=overview&severity=CRITICAL");
  });
});
