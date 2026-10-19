import { z } from 'zod';
import { ConventionCategory } from '@devdigest/shared';

/**
 * What the model returns for one scan (`schemaName: 'ConventionExtraction'`).
 *
 * Field order is generation order: the model writes the rule and the evidence
 * it observed before it labels the category and judges its confidence.
 * No min/max here — strict json_schema mode rejects some bounds; caps and
 * clamping are applied in code after the call.
 */
export const ExtractedConvention = z.object({
  rule: z.string(),
  evidence: z.object({
    path: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
    snippet: z.string(),
  }),
  category: ConventionCategory,
  confidence: z.number(),
});
export type ExtractedConvention = z.infer<typeof ExtractedConvention>;

export const ConventionExtraction = z.object({
  conventions: z.array(ExtractedConvention),
});
export type ConventionExtraction = z.infer<typeof ConventionExtraction>;
