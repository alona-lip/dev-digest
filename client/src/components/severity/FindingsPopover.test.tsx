/**
 * FindingsPopover — the PR-list hover preview. Read-only by design: Accept /
 * Dismiss only exist on the PR-detail FindingCard, a different component
 * with its own network calls. This popover must never render a button.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Finding, PrAgentFindings } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsPopover } from "./FindingsPopover";

afterEach(cleanup);

const FINDINGS: Finding[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded Stripe secret key in commit",
    file: "src/config.ts",
    start_line: 12,
    end_line: 12,
    rationale: "Line 12 contains a literal string starting with sk_live_, which appears to be a Stripe secret key.",
    suggestion: null,
    confidence: 0.98,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query in user list endpoint",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "The loop on line 46 calls db.posts.findMany({ userId }) once per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
  },
];

// A stand-in for a real getBoundingClientRect() snapshot — geometry doesn't
// matter for these tests, only that a non-null anchor is present.
const ANCHOR = new DOMRect(100, 200, 120, 24);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPopover", () => {
  it("shows the total count in the title, not just the preview length", () => {
    renderWithIntl(<FindingsPopover findings={FINDINGS} total={6} anchorRect={ANCHOR} />);
    expect(screen.getByText("6 FINDINGS IN THIS RUN")).toBeInTheDocument();
  });

  it("shows severity, title, category, file:line and confidence for each preview finding", () => {
    renderWithIntl(<FindingsPopover findings={FINDINGS} total={2} anchorRect={ANCHOR} />);
    expect(screen.getByText("Hardcoded Stripe secret key in commit")).toBeInTheDocument();
    expect(screen.getByText("security")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("98% conf")).toBeInTheDocument();

    expect(screen.getByText("N+1 query in user list endpoint")).toBeInTheDocument();
    expect(screen.getByText("perf")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    expect(screen.getByText("86% conf")).toBeInTheDocument();
  });

  it("never renders an interactive control — read-only preview", () => {
    renderWithIntl(<FindingsPopover findings={FINDINGS} total={2} anchorRect={ANCHOR} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(document.querySelectorAll("[onclick]")).toHaveLength(0);
  });

  it("renders nothing when there's no anchor yet (not open)", () => {
    const { container } = renderWithIntl(
      <FindingsPopover findings={FINDINGS} total={2} anchorRect={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders through a portal into document.body, not wherever it's mounted — this is the fix for the overflow:hidden clipping bug (the PR-list table card clips absolutely-positioned children)", () => {
    const mountPoint = document.createElement("div");
    document.body.appendChild(mountPoint);
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPopover findings={FINDINGS} total={2} anchorRect={ANCHOR} />
      </NextIntlClientProvider>,
      { container: mountPoint },
    );
    const tooltip = screen.getByRole("tooltip");
    expect(mountPoint.contains(tooltip)).toBe(false);
    expect(document.body.contains(tooltip)).toBe(true);
    document.body.removeChild(mountPoint);
  });
});

describe("FindingsPopover — grouped by agent (PR list)", () => {
  const GROUPS: PrAgentFindings[] = [
    {
      agent_id: "a-sec",
      agent_name: "Security Reviewer",
      review_id: "r-sec",
      score: 65,
      findings_by_severity: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
      findings: [FINDINGS[0]!],
    },
    {
      agent_id: null,
      agent_name: null,
      review_id: "r-legacy",
      score: null,
      findings_by_severity: { CRITICAL: 0, WARNING: 1, SUGGESTION: 0 },
      findings: [FINDINGS[1]!],
    },
    {
      // Reviewed, clean — no section for it.
      agent_id: "a-clean",
      agent_name: "Clean Reviewer",
      review_id: "r-clean",
      score: 100,
      findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      findings: [],
    },
  ];

  it("titles the popover with the total and the number of agents with findings", () => {
    renderWithIntl(<FindingsPopover groups={GROUPS} total={2} anchorRect={ANCHOR} />);
    expect(screen.getByText("2 FINDINGS · 2 AGENTS")).toBeInTheDocument();
  });

  it("renders one section per agent with findings, each holding only its own findings", () => {
    renderWithIntl(<FindingsPopover groups={GROUPS} total={2} anchorRect={ANCHOR} />);
    const sec = screen.getByRole("region", { name: "Security Reviewer" });
    expect(sec).toHaveTextContent("Hardcoded Stripe secret key in commit");
    expect(sec).not.toHaveTextContent("N+1 query in user list endpoint");
    expect(screen.queryByRole("region", { name: "Clean Reviewer" })).not.toBeInTheDocument();
  });

  it("labels a group with no agent name as 'Unknown agent'", () => {
    renderWithIntl(<FindingsPopover groups={GROUPS} total={2} anchorRect={ANCHOR} />);
    const unknown = screen.getByRole("region", { name: "Unknown agent" });
    expect(unknown).toHaveTextContent("N+1 query in user list endpoint");
  });

  it("each group header shows that agent's own score; a null score renders no ring", () => {
    renderWithIntl(<FindingsPopover groups={GROUPS} total={2} anchorRect={ANCHOR} />);
    const sec = screen.getByRole("region", { name: "Security Reviewer" });
    expect(within(sec).getByText("65")).toBeInTheDocument();
    const unknown = screen.getByRole("region", { name: "Unknown agent" });
    expect(unknown.querySelector("svg circle")).toBeNull();
  });

  it("per-agent pills are read-only — still no buttons anywhere in the popover", () => {
    renderWithIntl(<FindingsPopover groups={GROUPS} total={2} anchorRect={ANCHOR} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
