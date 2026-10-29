import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ContextAttachments, ContextDoc } from "@devdigest/shared";
import messages from "@messages/en/context.json";
import { ContextDocsPicker } from "./ContextDocsPicker";

type Kind = "agent" | "skill";

const doc = (path: string, over: Partial<ContextDoc> = {}): ContextDoc => ({
  path,
  type: "docs",
  size_bytes: 10,
  tokens: 100,
  too_large: false,
  ...over,
});

const DOCS: ContextDoc[] = [
  doc("specs/auth.md", { type: "specs", tokens: 100 }),
  doc("docs/guide.md", { tokens: 200 }),
  doc("docs/huge.md", { tokens: null, too_large: true, size_bytes: 2_000_000 }),
  doc("memory/notes.md", { type: "insights", tokens: 50 }),
];

const ad = (path: string, tokens: number | null, extra: object = {}) => ({
  path,
  type: "docs" as const,
  tokens,
  too_large: false,
  missing: false,
  ...extra,
});

let attachments: ContextAttachments;
let putBodies: { paths: string[] }[];
let putStatus: number;
let docRequests: string[];

function baseAttachments(kind: Kind): ContextAttachments {
  const own = [ad("specs/auth.md", 100), ad("old/gone.md", null, { type: null, missing: true })];
  return {
    repo_id: "r1",
    paths: own.map((d) => d.path),
    docs: own,
    inherited:
      kind === "agent"
        ? [
            { ...ad("specs/auth.md", 100), via_skill: { skill_id: "s1", name: "rubric" } },
            { ...ad("docs/guide.md", 200), via_skill: { skill_id: "s1", name: "rubric" } },
          ]
        : [],
  };
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      if (init?.method === "PUT") {
        putBodies.push(JSON.parse(String(init.body)));
        if (putStatus !== 200) return json({ error: { code: "boom", message: "boom" } }, putStatus);
        const paths = putBodies.at(-1)!.paths;
        const known = new Map(attachments.docs.map((d) => [d.path, d]));
        attachments = {
          ...attachments,
          paths,
          docs: paths.map((p) => known.get(p) ?? ad(p, DOCS.find((d) => d.path === p)?.tokens ?? null)),
        };
        return json(attachments);
      }
      if (url.includes("/context/file")) {
        docRequests.push(url);
        return json({ path: "docs/guide.md", type: "docs", content: "# Guide heading\n\nbody", tokens: 200 });
      }
      if (url.includes("/repos/r1/context")) return json({ status: "ok", glob: "**/*.md", truncated: false, read_at: "t", docs: DOCS });
      if (url.includes("/context?repo_id=")) return json(attachments);
      return json({}, 404);
    }),
  );
}

const renderPicker = (kind: Kind, repoId: string | null = "r1") => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <ContextDocsPicker kind={kind} ownerId="o1" repoId={repoId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
};

const checkbox = (path: string) => screen.getByRole("checkbox", { name: new RegExp(path.replace(/[./]/g, "\\$&")) });
const lastPut = () => putBodies.at(-1)?.paths;

beforeEach(() => {
  putBodies = [];
  putStatus = 200;
  docRequests = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each<Kind>(["agent", "skill"])("ContextDocsPicker (%s)", (kind) => {
  const setup = async (repoId: string | null = "r1") => {
    attachments = baseAttachments(kind);
    installFetch();
    const user = userEvent.setup();
    renderPicker(kind, repoId);
    if (repoId) await screen.findByRole("checkbox", { name: /docs\/guide\.md/ });
    return user;
  };

  it("AC-21: rows show checkbox, file name, directory, type badge, Preview; filter and counter", async () => {
    await setup();
    expect(screen.getByPlaceholderText("Filter documents…")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 attached")).toBeInTheDocument();
    const row = screen.getAllByTestId("doc-row").find((r) => within(r).queryByRole("checkbox", { name: /specs\/auth\.md/ }))!;
    expect(within(row).getByText("auth.md")).toBeInTheDocument();
    expect(within(row).getAllByText("specs")).toHaveLength(2); // directory + type badge label
    expect(within(row).getByRole("button", { name: "Preview specs/auth.md" })).toBeInTheDocument();
  });

  it("AC-22: a toggle saves the whole ordered list, keeping attachments hidden by the filter", async () => {
    const user = await setup();
    await user.type(screen.getByPlaceholderText("Filter documents…"), "NOTES");
    await user.click(checkbox("memory/notes.md"));
    await waitFor(() => expect(lastPut()).toBeDefined());
    expect(lastPut()).toEqual(["specs/auth.md", "old/gone.md", "memory/notes.md"]);
    expect(putBodies).toHaveLength(1);
  });

  it("AC-22: two rapid toggles end with both changes saved, in order", async () => {
    const user = await setup();
    // Hold the first PUT so the second toggle happens while it is in flight.
    const realFetch = globalThis.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    let puts = 0;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      init?.method === "PUT" && puts++ === 0 ? gate.then(() => realFetch(url, init)) : realFetch(url, init),
    );
    await user.click(checkbox("memory/notes.md"));
    await user.click(checkbox("specs/auth.md"));
    release();
    await waitFor(() => expect(putBodies).toHaveLength(2));
    expect(putBodies.map((b) => b.paths)).toEqual([
      ["specs/auth.md", "old/gone.md", "memory/notes.md"],
      ["old/gone.md", "memory/notes.md"],
    ]);
    await waitFor(() => expect(attachments.paths).toEqual(["old/gone.md", "memory/notes.md"]));
    expect(checkbox("memory/notes.md")).toBeChecked();
  });

  it("AC-23: a failed save restores the previous state and shows the error", async () => {
    const user = await setup();
    putStatus = 500;
    await user.click(checkbox("memory/notes.md"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t save the attachments");
    await waitFor(() => expect(checkbox("memory/notes.md")).not.toBeChecked());
  });

  it("AC-24: the ↑/↓ buttons save the reordered paths", async () => {
    const user = await setup();
    await user.click(checkbox("memory/notes.md"));
    await waitFor(() => expect(lastPut()).toEqual(["specs/auth.md", "old/gone.md", "memory/notes.md"]));
    await user.click(await screen.findByRole("button", { name: "Move memory/notes.md up" }));
    await waitFor(() => expect(lastPut()).toEqual(["specs/auth.md", "memory/notes.md", "old/gone.md"]));
  });

  it("AC-24: dragging an attached row onto another saves the new order", async () => {
    await setup();
    const rows = screen.getAllByTestId("doc-row");
    const first = rows.find((r) => within(r).queryByRole("checkbox", { name: /specs\/auth\.md/ }))!;
    const second = rows.find((r) => within(r).queryByRole("checkbox", { name: /old\/gone\.md/ }))!;
    fireEvent.dragStart(first);
    fireEvent.dragOver(second);
    fireEvent.drop(second);
    await waitFor(() => expect(lastPut()).toEqual(["old/gone.md", "specs/auth.md"]));
  });

  it("AC-25: reordering is disabled while the filter is non-empty", async () => {
    const user = await setup();
    await user.type(screen.getByPlaceholderText("Filter documents…"), "auth");
    expect(screen.getByRole("button", { name: "Move specs/auth.md down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move specs/auth.md up" })).toBeDisabled();
    const row = screen.getByTestId("doc-row");
    expect(row).toHaveAttribute("draggable", "false");
  });

  it("AC-29: Preview shows the rendered document and saves nothing", async () => {
    const user = await setup();
    await user.click(screen.getByRole("button", { name: "Preview docs/guide.md" }));
    expect(await screen.findByRole("heading", { name: "Guide heading" })).toBeInTheDocument();
    expect(docRequests).toHaveLength(1);
    expect(putBodies).toHaveLength(0);
  });

  it("AC-30: a too_large document has a disabled checkbox and a reason", async () => {
    await setup();
    expect(checkbox("docs/huge.md")).toBeDisabled();
    expect(screen.getByText(/Too large \(over 1 MB\)/)).toBeInTheDocument();
  });

  it("AC-31: a missing path is its own row with status 'missing' and can be detached", async () => {
    const user = await setup();
    const row = screen.getAllByTestId("doc-row").find((r) => within(r).queryByRole("checkbox", { name: /old\/gone\.md/ }))!;
    expect(within(row).getByText("missing")).toBeInTheDocument();
    expect(checkbox("old/gone.md")).toBeChecked();
    await user.click(checkbox("old/gone.md"));
    await waitFor(() => expect(lastPut()).toEqual(["specs/auth.md"]));
  });

  it("AC-32: without a repository a hint is shown and no checkboxes", async () => {
    await setup(null);
    expect(screen.getByText(/Select a repository in the sidebar/)).toBeInTheDocument();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("AC-35: type badge carries a text label", async () => {
    await setup();
    const row = screen.getAllByTestId("doc-row").find((r) => within(r).queryByRole("checkbox", { name: /memory\/notes\.md/ }))!;
    expect(within(row).getByText("insights")).toBeInTheDocument();
  });
});

describe("ContextDocsPicker (agent only)", () => {
  const setup = async (mutate?: (a: ContextAttachments) => void) => {
    attachments = baseAttachments("agent");
    mutate?.(attachments);
    installFetch();
    renderPicker("agent");
    await screen.findByRole("checkbox", { name: /docs\/huge\.md/ });
  };

  it("AC-26: inherited documents are locked 'via <skill>' and a duplicate of an own path shows once", async () => {
    await setup();
    expect(screen.getByText("via rubric")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox", { name: /specs\/auth\.md/ })).toHaveLength(1);
    const guide = screen.getAllByRole("checkbox", { name: /docs\/guide\.md/ });
    expect(guide).toHaveLength(1);
    expect(guide[0]).toBeDisabled();
    expect(guide[0]).toBeChecked();
  });

  it("AC-27: the footer shows the token sum of the effective set, 0 when empty", async () => {
    await setup();
    expect(screen.getByText("≈ 300 tokens")).toBeInTheDocument();
    cleanup();
    await setup((a) => {
      a.paths = [];
      a.docs = [];
      a.inherited = [];
    });
    expect(screen.getByText("≈ 0 tokens")).toBeInTheDocument();
  });

  it("AC-28: attaching a listed document shows no budget warning while the save is in flight", async () => {
    await setup();
    const user = userEvent.setup();
    // Hold the PUT open so the optimistic state is what is rendered.
    const realFetch = globalThis.fetch;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
      init?.method === "PUT" ? gate.then(() => realFetch(url, init)) : realFetch(url, init),
    );
    await user.click(checkbox("memory/notes.md"));
    await waitFor(() => expect(checkbox("memory/notes.md")).toBeChecked());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("≈ 350 tokens")).toBeInTheDocument();
    release();
    await waitFor(() => expect(putBodies).toHaveLength(1));
  });

  it("AC-28: over the 12,000 budget the warning names the skipped documents", async () => {
    await setup((a) => {
      a.paths = ["a.md", "b.md", "c.md"];
      a.docs = [ad("a.md", 7000), ad("b.md", 7000), ad("c.md", 2000)];
      a.inherited = [];
    });
    expect(screen.getByRole("status")).toHaveTextContent("b.md");
    expect(screen.getByRole("status")).not.toHaveTextContent("c.md");
  });
});
