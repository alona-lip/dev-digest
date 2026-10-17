import { describe, it, expect } from "vitest";
import type { AgentSkillLink, SkillListItem } from "@devdigest/shared";
import { countEnabled, filterRows, mergeSkillRows, moveRow, toggleRow, toPayload } from "./helpers";

const sk = (id: string, name: string, enabled = true): SkillListItem => ({
  id,
  name,
  description: "d",
  type: "rubric",
  source: "manual",
  body: "b",
  enabled,
  version: 1,
  tokens: 1,
  created_at: "2026-01-01T00:00:00Z",
  agent_count: 0,
  pull_rate: null,
  accept_rate: null,
});
const link = (skill_id: string, order: number, enabled: boolean): AgentSkillLink => ({
  agent_id: "ag",
  skill_id,
  order,
  enabled,
});

const SKILLS = [sk("a", "alpha"), sk("b", "bravo"), sk("c", "charlie"), sk("d", "delta")];

describe("mergeSkillRows", () => {
  it("lists bound skills in the agent's order (the prompt order), then the rest by name", () => {
    const rows = mergeSkillRows(SKILLS, [link("c", 0, true), link("a", 1, false)]);
    expect(rows.map((r) => [r.skill.id, r.bound, r.enabled])).toEqual([
      ["c", true, true],
      ["a", true, false],
      ["b", false, false],
      ["d", false, false],
    ]);
  });
  it("ignores links to skills that no longer exist", () => {
    expect(mergeSkillRows(SKILLS, [link("zzz", 0, true)]).every((r) => !r.bound)).toBe(true);
  });
});

describe("toggleRow", () => {
  const rows = mergeSkillRows(SKILLS, [link("c", 0, true), link("a", 1, true)]);
  it("flips a bound row in place, keeping its position", () => {
    const next = toggleRow(rows, "c");
    expect(next.map((r) => r.skill.id)).toEqual(["c", "a", "b", "d"]);
    expect(next[0]).toMatchObject({ bound: true, enabled: false });
  });
  it("binds + enables an unbound row at the END of the bound block", () => {
    const next = toggleRow(rows, "d");
    expect(next.map((r) => r.skill.id)).toEqual(["c", "a", "d", "b"]);
    expect(next[2]).toMatchObject({ bound: true, enabled: true });
  });
  it("binds the first skill of an empty agent at the top", () => {
    const next = toggleRow(mergeSkillRows(SKILLS, []), "b");
    expect(next.map((r) => r.skill.id)).toEqual(["b", "a", "c", "d"]);
  });
});

describe("moveRow", () => {
  const rows = mergeSkillRows(SKILLS, [link("a", 0, true), link("b", 1, true), link("c", 2, true)]);
  it("reorders within the bound block", () => {
    expect(moveRow(rows, 0, 2).map((r) => r.skill.id)).toEqual(["b", "c", "a", "d"]);
    expect(moveRow(rows, 2, 0).map((r) => r.skill.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("never moves an unbound row or drops one past the bound block", () => {
    expect(moveRow(rows, 3, 0)).toBe(rows);
    expect(moveRow(rows, 0, 3)).toBe(rows);
    expect(moveRow(rows, 1, 1)).toBe(rows);
  });
});

describe("toPayload / countEnabled / filterRows", () => {
  const rows = toggleRow(mergeSkillRows(SKILLS, [link("a", 0, false)]), "b");
  it("sends only bound rows, in order, with their enabled flag", () => {
    expect(toPayload(rows)).toEqual([
      { skill_id: "a", enabled: false },
      { skill_id: "b", enabled: true },
    ]);
  });
  it("counts enabled rows, but not skills switched off globally", () => {
    expect(countEnabled(rows)).toBe(1);
    const off = mergeSkillRows([sk("a", "alpha", false)], [link("a", 0, true)]);
    expect(countEnabled(off)).toBe(0);
  });
  it("filters by name", () => {
    expect(filterRows(rows, "RAV").map((r) => r.skill.id)).toEqual(["b"]);
    expect(filterRows(rows, "")).toHaveLength(4);
  });
});
