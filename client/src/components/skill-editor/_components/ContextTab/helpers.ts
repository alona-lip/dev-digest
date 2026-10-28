/** The read-only "Serializes as" text: heading + one `- <path>` line per document, in order. */
export function serializeSpecs(paths: readonly string[]): string {
  return ["## Project specifications", ...paths.map((p) => `- ${p}`)].join("\n");
}
