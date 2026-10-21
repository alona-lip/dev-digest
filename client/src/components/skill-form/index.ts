// The skill form shared by the Create-skill modal (/skills) and the editor's Config tab:
// the body field plus the validation rules and limits both forms apply.
export { SkillBodyField } from "./SkillBodyField";
export { MAX_BODY, MAX_DESCRIPTION, MAX_NAME, SKILL_TYPES } from "./constants";
export { approxTokens, bodyFileName, validateSkillForm, type FormError, type SkillFormValues } from "./helpers";
