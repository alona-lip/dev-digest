import { MAX_BODY, MAX_DESCRIPTION, MAX_NAME } from "./constants";

export interface SkillFormValues {
  name: string;
  description: string;
  body: string;
}

export type FormError = "name" | "nameLong" | "description" | "descriptionLong" | "body" | "bodyLong";

/** Mirrors the server's CreateSkillInput limits so the form fails before the request. */
export function validateSkillForm(v: SkillFormValues): FormError | null {
  if (!v.name.trim()) return "name";
  if (v.name.trim().length > MAX_NAME) return "nameLong";
  if (!v.description.trim()) return "description";
  if (v.description.trim().length > MAX_DESCRIPTION) return "descriptionLong";
  if (!v.body.trim()) return "body";
  if (v.body.length > MAX_BODY) return "bodyLong";
  return null;
}
