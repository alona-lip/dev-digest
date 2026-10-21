import { z } from 'zod';

/**
 * What the model returns for a Re-scan (`schemaName: 'SkillInjectionVerdict'`).
 * Findings come before the verdict, so the model cites the text first and then
 * judges it. No min/max: strict json_schema mode rejects some bounds.
 */
export const SkillInjectionVerdict = z.object({
  findings: z.array(
    z.object({
      /** Short description of the manipulation, e.g. "Forces an approve verdict". */
      label: z.string(),
      /** The offending text, copied verbatim from the skill body. */
      excerpt: z.string(),
    }),
  ),
  injection: z.boolean(),
});
export type SkillInjectionVerdict = z.infer<typeof SkillInjectionVerdict>;
