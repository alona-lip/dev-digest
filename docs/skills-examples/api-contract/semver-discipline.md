---
name: semver-discipline
description: Use when a diff contains a breaking change (per breaking-change or response-schema) to a versioned contract — a published package with a package.json version, or a versioned HTTP API (/v1). Check that the version bump matches the change — breaking ⇒ major, additive ⇒ minor, fix ⇒ patch — and report a breaking change shipped under a minor, patch or missing bump.
type: convention
---
# Semver discipline

The version number is a promise to callers. Map the change in the diff to the bump it requires:

| Change in the diff | Required bump |
|---|---|
| Removed/renamed route, field, export; retyped or newly-required input; stricter validation | **major** (`1.4.2 → 2.0.0`) or new API version (`/v1` → `/v2`) |
| New optional field, new route, new export | **minor** (`1.4.2 → 1.5.0`) |
| Bug fix with an unchanged contract | **patch** (`1.4.2 → 1.4.3`) |

## What to report

- A breaking change with a minor/patch bump or no bump at all.
- A breaking change to `/v1/...` handlers instead of a new `/v2/...` next to them.
- A major bump with no breaking change in the diff (SUGGESTION: it forces callers to upgrade for nothing).

**Skip** packages with `"private": true` that are never published, and unversioned internal routes — unless the diff itself adds a version. Do not invent a versioning scheme the repo does not have.

## Severity

- **CRITICAL** — the version claims compatibility (minor/patch) while the diff breaks a contract of a published package or versioned API.
- **WARNING** — a breaking change and no bump, where the package is versioned.

## Example

**Bad** — a response field is removed and the package ships it as a minor:

```diff
- "version": "1.4.0",
+ "version": "1.5.0",
...
-   total_cost_usd: z.number().nullable(),
```

→ CRITICAL: `total_cost_usd` removed under a minor bump; `^1.4.0` consumers upgrade automatically and break.

**Good** — either bump the major (`"version": "2.0.0"`), or keep the field deprecated and ship `1.5.0`.
