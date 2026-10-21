import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "@messages/en/conventions.json";
import type { AgentListItem, ConventionSkillDraft } from "@devdigest/shared";

interface QueryState<T> {
  data: T | undefined;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
}
let DRAFT: QueryState<ConventionSkillDraft>;
let AGENTS: QueryState<AgentListItem[]>;

vi.mock("@/lib/hooks/conventions", () => ({ useConventionSkillDraft: () => DRAFT }));
vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => AGENTS }));
// The form itself is covered by SkillDraftForm.test.tsx; here only the hand-off matters.
vi.mock("./_components/SkillDraftForm", () => ({
  SkillDraftForm: ({ draft, agents, repoName }: { draft: ConventionSkillDraft; agents: AgentListItem[]; repoName: string }) => (
    <div>
      form for {draft.name} in {repoName} with {agents.length} agents
    </div>
  ),
}));

import { CreateSkillFromConventionsModal } from "./CreateSkillFromConventionsModal";

const draft = { name: "repo-conventions" } as ConventionSkillDraft;
const agents = [{ id: "a1", name: "General Reviewer" }] as AgentListItem[];
const query = <T,>(data?: T, isError = false): QueryState<T> => ({ data, isError, refetch: vi.fn() });

beforeEach(() => {
  DRAFT = query<ConventionSkillDraft>();
  AGENTS = query<AgentListItem[]>();
});
afterEach(cleanup);

function renderModal() {
  const onClose = vi.fn();
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CreateSkillFromConventionsModal repoId="r1" repoName="payments-api" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return { onClose, container };
}

describe("CreateSkillFromConventionsModal", () => {
  it("shows a loading skeleton until BOTH the draft and the agents have loaded", () => {
    DRAFT = query(draft);
    const { container } = renderModal();
    expect(screen.getByText("Create skill from conventions")).toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText(/form for/)).not.toBeInTheDocument();
  });

  it("hands the draft and the agents to the form once both have loaded", () => {
    DRAFT = query(draft);
    AGENTS = query(agents);
    renderModal();
    expect(screen.getByText("form for repo-conventions in payments-api with 1 agents")).toBeInTheDocument();
  });

  it("on a failed load shows an error whose Retry refetches both queries", async () => {
    DRAFT = query<ConventionSkillDraft>(undefined, true);
    AGENTS = query(agents);
    renderModal();
    expect(screen.getByText("Could not build the skill draft.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(DRAFT.refetch).toHaveBeenCalledTimes(1);
    expect(AGENTS.refetch).toHaveBeenCalledTimes(1);
  });

  it("Cancel closes the modal while it is still loading", async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
