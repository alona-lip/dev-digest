/** `23-31`, or `23` for a one-line range. */
export function lineRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}
