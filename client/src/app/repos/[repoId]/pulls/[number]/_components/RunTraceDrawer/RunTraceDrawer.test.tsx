import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "@messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

let traceOverride: RunTrace | null = null;
vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: traceOverride ?? TRACE, isLoading: false }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(() => {
  cleanup();
  traceOverride = null;
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("shows the COST stat tile alongside duration/tokens/findings", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.06")).toBeInTheDocument();
  });

  it("a trace written before cost was tracked shows '—', not '$0.00'", () => {
    // Older traces simply omit the key — the tile must degrade, not lie.
    const { cost_usd: _omitted, ...statsWithoutCost } = TRACE.stats;
    TRACE.stats = statsWithoutCost;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
    TRACE.stats = { ...statsWithoutCost, cost_usd: 0.06 };
  });

  it("switches to the live log tab", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Live log" }));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("Run Trace drawer — skills in the prompt assembly", () => {
  const openPromptAssembly = () => userEvent.click(screen.getByText("Prompt assembly"));

  const withSkills = (blocks: NonNullable<RunTrace["prompt_assembly"]["skill_blocks"]>): RunTrace => ({
    ...TRACE,
    prompt_assembly: { ...TRACE.prompt_assembly, skills: "joined", skill_blocks: blocks },
  });

  it("shows one block per enabled skill with the tokens it added, and a total", async () => {
    traceOverride = withSkills([
      { skill_id: "s1", name: "secret-leakage-gate", version: 3, text: "### Skill: secret-leakage-gate\nx", tokens: 180 },
      { skill_id: "s2", name: "lethal-trifecta", version: 1, text: "### Skill: lethal-trifecta\ny", tokens: 232 },
    ]);
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    await openPromptAssembly();
    expect(screen.getByText("Skill: secret-leakage-gate · v3")).toBeInTheDocument();
    expect(screen.getByText("Skill: lethal-trifecta · v1")).toBeInTheDocument();
    expect(screen.getByText("+180 tokens")).toBeInTheDocument();
    expect(screen.getByText("+232 tokens")).toBeInTheDocument();
    expect(screen.getByTestId("skills-summary")).toHaveTextContent("2 skills attached — +412 tokens");
    // the legacy joined block is not rendered next to the per-skill ones
    expect(screen.queryByText("Skills (dynamic)")).not.toBeInTheDocument();
  });

  it("renders no skills block at all when no skill was in the prompt", async () => {
    traceOverride = { ...TRACE, prompt_assembly: { ...TRACE.prompt_assembly, skills: null, skill_blocks: [] } };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    await openPromptAssembly();
    expect(screen.queryByTestId("skills-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("Skills (dynamic)")).not.toBeInTheDocument();
  });

  it("still renders an older trace that only has the joined skills string", async () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    await openPromptAssembly();
    expect(screen.getByText("Skills (dynamic)")).toBeInTheDocument();
  });
});
