import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview", () => {
  it("renders markdown structure as elements", () => {
    render(<MarkdownPreview>{"# Title\n\nsome **bold** text"}</MarkdownPreview>);
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("never turns raw html or scripts into elements", () => {
    const { container } = render(
      <MarkdownPreview>
        {'# Safe\n\n<script>window.__pwned = 1</script>\n\n<img src="x" onerror="window.__pwned = 1">\n\n[x](javascript:alert(1))'}
      </MarkdownPreview>,
    );
    expect(screen.getByRole("heading", { name: "Safe" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
    const link = container.querySelector("a");
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});
