# Skill import from URL

Status: implemented (2026-10-20).

The Add skill modal gets a third tab, **Import from URL**. The server fetches
the URL, runs the result through the same parser as a file import, and returns
an editable preview. Nothing is saved until the user confirms. The skill is then
created through `POST /skills` with `source: 'imported_url'` and `enabled: false`
("left disabled until vetted", as the existing `url.hint` copy already says).

## Contract

- `SkillImportUrlRequest = { url: string (trimmed, URL, ≤ 2000) }`
- `POST /skills/import/url-preview` → `SkillImportPreview` (the file-import
  shape; `source_file` is the final URL after redirects). Writes nothing.
- `CreateSkillInput.source` accepts `'imported_url'` as well.

## Flow

`normalizeSkillUrl` (pure) → `container.urlFetcher.fetch` (adapter, I/O) →
`filenameFromUrl` (pure) → `buildImportPreview` (the existing parser) →
`name_conflict` check.

- `github.com/<owner>/<repo>/blob/<ref>/<path>` is rewritten to
  `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`. The blob page is HTML.
- The file type comes from the last path segment (`.md`, `.markdown`, `.zip`).
  Without an extension, `application/zip` means zip and `text/plain` /
  `text/markdown` mean markdown. Anything else, `text/html` included, is a 422.

## The fetcher (`src/adapters/http/safe-fetch.ts`)

A port `UrlFetcher` in `vendor/shared/adapters.ts`. The one implementation,
`SafeUrlFetcher`, uses only `node:https` and `node:dns`.

- `https:` only; a URL with `user:pass@` is rejected.
- A custom `lookup` on the request rejects loopback, private (10/8,
  172.16/12, 192.168/16), link-local (169.254/16, cloud metadata), CGNAT
  (100.64/10), `0.0.0.0/8`, multicast/reserved, IPv6 `::1`, `::`, `fc00::/7`,
  `fe80::/10`, and IPv4-mapped forms of all of these. The check runs on the
  address the socket actually connects to, so DNS rebinding can't swap it.
- Redirects are followed by hand, at most 3, each through the same checks.
- 10 s timeout; the body is streamed and aborted past 512 KB
  (`MAX_IMPORT_FILE_BYTES`).
- Non-2xx → `ValidationError` with a short message.

## Rejected alternatives

- **Fetch in the browser.** CORS blocks most hosts, and the bytes would skip
  the server-side limits and parser.
- **Plain `fetch()` without an address check.** The API could then be used to
  reach the local network or a cloud metadata endpoint (SSRF).
- **`undici` Agent with a `connect.lookup`.** Works, but `undici` is not a
  direct dependency and `node:https` gives the same hook with no new package.

## Acceptance

- Raw gist `.md` and a GitHub `blob` link both produce a preview.
- `http://…`, `https://localhost/…`, `https://169.254.169.254/…` → 422.
- The preview writes no row; saving creates an `imported_url` skill, disabled.
