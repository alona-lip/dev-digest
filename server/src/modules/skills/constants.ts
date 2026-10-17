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
