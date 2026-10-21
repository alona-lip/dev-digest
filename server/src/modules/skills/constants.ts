/** Import limits. Everything here is pre-parse: a hostile archive is bounded
 *  before any byte of it is inflated. */
export const MAX_IMPORT_FILE_BYTES = 512 * 1024;
export const MAX_ARCHIVE_ENTRIES = 200;
export const MAX_SKILL_MD_BYTES = 64 * 1024;
export const MAX_BODY_CHARS = 20_000;
export const MAX_NAME_CHARS = 80;
export const MAX_DESCRIPTION_CHARS = 500;

/** Rolling window for the Stats tab. */
export const STATS_WINDOW_DAYS = 30;

export const INITIAL_VERSION_NOTE = 'Initial version';
export const DEFAULT_UPDATE_NOTE = 'Updated body';

/** Extensions that mean "this could be run". Listed, never read. */
export const EXECUTABLE_EXT = new Set([
  'sh', 'bash', 'zsh', 'fish', 'py', 'rb', 'pl', 'php', 'js', 'mjs', 'cjs', 'ts', 'tsx',
  'ps1', 'bat', 'cmd', 'com', 'exe', 'dll', 'so', 'dylib', 'bin', 'jar', 'class', 'wasm',
  'msi', 'app', 'command', 'scpt', 'vbs',
]);

/** Extensions that are plainly not text. */
export const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'gz', 'tgz', 'tar', 'bz2', '7z',
  'rar', 'mp3', 'mp4', 'mov', 'woff', 'woff2', 'ttf', 'otf', 'sqlite', 'db',
]);

// ---- Import from URL --------------------------------------------------------

export const URL_FETCH_TIMEOUT_MS = 10_000;

/** Content types a raw skill file may be served as, when the URL has no extension. */
export const MARKDOWN_CONTENT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
export const ZIP_CONTENT_TYPES = new Set(['application/zip', 'application/x-zip-compressed']);

// ---- Prompt-injection scan --------------------------------------------------

export interface InjectionPattern {
  rule: string;
  label: string;
  /** Must carry the `g` flag — every hit is reported with its line. */
  re: RegExp;
}

// Filler words an attacker puts between the verb and its object ("ignore ALL THE previous …").
const Q = String.raw`(?:(?:all|any|the|your|of|these|those)\s+)*`;

/**
 * Phrasings that make a skill body steer the reviewer instead of informing it.
 * A denylist only ever catches known phrasings. That is why Re-scan also asks a
 * model (server/specs/skill-injection-scan.md). Each pattern is kept narrow
 * enough not to fire on an ordinary rubric. A skill that QUOTES an attack
 * verbatim is still flagged on purpose: the model reads a quote like any other text.
 */
export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    rule: 'ignore_previous',
    label: 'Tells the model to ignore its previous instructions',
    re: new RegExp(
      String.raw`\b(?:ignore|disregard|forget|override)\s+${Q}(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|rules|prompts?|guidelines|directions|directives)\b`,
      'gi',
    ),
  },
  {
    rule: 'role_override',
    label: "Tries to change the model's role",
    re: /\byou\s+are\s+now\b|\bact\s+as\s+(?:an?\s+)?(?:unrestricted|unfiltered|jailbroken|uncensored)\b|\bdeveloper\s+mode\b|\bjailbreak(?:ed)?\b|\bno\s+longer\s+bound\s+by\b/gi,
  },
  {
    rule: 'fake_role_header',
    label: 'Fakes a system/assistant message or a prompt delimiter',
    re: /^[ \t>*_#-]*(?:system|assistant|developer)\s*:|<\s*\/?\s*(?:system|untrusted|instructions?|im_start|im_end)\b[^>]*>/gim,
  },
  {
    rule: 'safety_override',
    label: 'Tries to override safety or security rules',
    re: new RegExp(
      String.raw`\b(?:override|bypass|disable|ignore|circumvent)\s+${Q}(?:(?:safety|security|content)\s+(?:guidelines|guardrails|restrictions|safeguards|filters|policies|rules|checks)|guardrails|safeguards)\b`,
      'gi',
    ),
  },
  {
    rule: 'prompt_exfiltration',
    label: 'Asks to reveal the system prompt or configuration',
    re: new RegExp(
      String.raw`\b(?:output|reveal|print|show|leak|dump|repeat|disclose)\s+${Q}(?:system\s+prompts?|(?:hidden|original|initial|previous)\s+instructions|(?:agent|system|model)\s+configurations?)\b`,
      'gi',
    ),
  },
  {
    rule: 'verdict_manipulation',
    label: 'Dictates the review verdict or suppresses security findings',
    re: /\b(?:always|automatically)\s+(?:approve|give\s+(?:a\s+)?(?:score|rating)|return\s+(?:a\s+)?score)\b|\bapprove\s+(?:all|every|any)\s+(?:prs?|pull\s+requests?|changes|code)\b|\bnever\s+(?:flag|mention|report|raise)\s+(?:any\s+)?(?:security|vulnerabilit|secrets?|injection)/gi,
  },
];

/** Cap on stored findings — one hostile body must not bloat the row. */
export const MAX_SCAN_FINDINGS = 50;
export const MAX_SCAN_EXCERPT_CHARS = 120;
/** Re-scan is a classification: no creativity wanted. */
export const SKILL_SCAN_TEMPERATURE = 0;
