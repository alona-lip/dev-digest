import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Read-only markdown preview for untrusted repository documents.
 * `skipHtml` drops raw HTML (no `rehype-raw`), so `<script>` / `<img onerror>`
 * never become elements; react-markdown's default urlTransform also strips
 * `javascript:` URLs.
 */
export function MarkdownPreview({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
