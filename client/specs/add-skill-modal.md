# Add skill modal

Status: implemented (2026-10-20).

One **+ Add Skill** button (no dropdown) opens one modal, **Add skill**, with
three tabs: **Create · From file · Import from URL**. It replaces the
two-item dropdown and its two separate modals.

## Layout

- `SkillsListPane` keeps one piece of state, `addTab: AddSkillTab | null`. The
  header button opens `create`; the empty-state call to action opens `file`.
- `AddSkillModal` (`SkillsListPane/_components/AddSkillModal/`) renders the
  vendored `Tabs` and only the active tab, so switching tabs resets it.
- No modal footer. Each tab ends with one full-width primary button; the modal
  closes with ✕.
- `CreateSkillTab`: name · description · type · `SkillBodyField` (Edit /
  Preview), validated with `validateSkillForm`, `source: 'manual'`.
- `FileImportTab`: the drop zone from the old `ImportSkillModal`.
- `UrlImportTab`: a URL field and **Fetch** → `POST /skills/import/url-preview`.
- `ImportPreviewForm`: the preview step both imports share, covering the trust
  banner, source, editable name/description/type, the rendered body, warnings,
  ignored files, the injection banner, and Save. URL imports save with
  `source: 'imported_url'` and `enabled: false`.

## Injection scan in the UI

See `server/specs/skill-injection-scan.md`.

- `SkillScanBanner` (`src/components/skill-scan-banner/`, shared by the editor
  and the import preview) shows the red "INJECTION DETECTED — DO NOT ENABLE"
  banner and the findings.
- Skill editor: the banner, an "Injection detected" badge next to the version,
  and a **Re-scan** button.
- The enabled toggle is locked on a blocked skill in the editor's Config tab
  and on the list card.

## Rejected alternatives

- **Keep two modals and add a third for URL.** That gives three entry points
  and two copies of the preview form.
- **Keep every tab mounted to preserve drafts.** File and URL previews would
  then sit side by side in hidden state. Resetting on switch is simpler, and
  the modal is short-lived.
