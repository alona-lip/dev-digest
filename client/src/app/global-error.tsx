/* Last-resort boundary for errors thrown by the ROOT layout itself. It
   replaces the whole document, so it renders its own <html>/<body> and uses
   no providers (no i18n, no theme) — they may be what failed. */
"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 48, background: "#0b0d10", color: "#e6e8eb" }}>
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>DevDigest hit an unexpected error</h1>
        <p style={{ opacity: 0.7, marginBottom: 20 }}>Reload the page, or retry below.</p>
        <button type="button" onClick={reset} style={{ padding: "8px 14px", cursor: "pointer" }}>
          Retry
        </button>
      </body>
    </html>
  );
}
