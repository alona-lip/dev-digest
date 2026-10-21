import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import messages from "@messages/en/prReview.json";

vi.mock("@/lib/hooks/reviews", () => ({ useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }) }));
vi.mock("../FindingsPanel", () => ({ FindingsPanel: () => <div>findings panel</div> }));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

const review = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "a1",
  run_id: "run-1",
  agent_name: "Test Quality Reviewer",
  kind: "review",
  verdict: null,
  summary: null,
  score: null,
  model: null,
  grounding: null,
  created_at: "2026-10-21T10:00:00.000Z",
  findings: [],
  ...over,
});

function renderAccordion(r: ReviewRecord, onOpenTrace = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ReviewRunAccordion review={r} prId="pr-1" onOpenTrace={onOpenTrace} />
    </NextIntlClientProvider>,
  );
  return onOpenTrace;
}

describe("ReviewRunAccordion", () => {
  it("the log icon opens this run's trace without toggling the accordion", async () => {
    const onOpenTrace = renderAccordion(review());
    await userEvent.click(screen.getByRole("button", { name: "Open run trace & logs" }));
    expect(onOpenTrace).toHaveBeenCalledWith("run-1");
    expect(screen.queryByText("findings panel")).not.toBeInTheDocument();
  });

  it("a review without a run has no trace to open", () => {
    renderAccordion(review({ run_id: null }));
    expect(screen.queryByRole("button", { name: "Open run trace & logs" })).not.toBeInTheDocument();
  });
});
