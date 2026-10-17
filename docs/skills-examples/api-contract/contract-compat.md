---
name: contract-compat
description: Use when a diff edits a shared zod schema or an exported function/type that other packages import. Check every importer still compiles and still parses what the producer sends; report each one that does not.
type: convention
---
# Contract compatibility

This repository vendors its zod contracts into `server`, `client` and `reviewer-core`. When the diff changes one:

1. Find the producer and every consumer (a quick search for the schema's name is enough).
2. Check the **wire** shape (`snake_case` field names, `UPPER_CASE` enum values) is unchanged, or that the diff changes producer and consumers together.
3. A signature change to an exported function is breaking if any importer passes the old arguments.

Report a contract that changed on one side only. Do not report a change that is additive and optional.
