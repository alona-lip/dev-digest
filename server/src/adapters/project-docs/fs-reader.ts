import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, resolve, sep } from 'node:path';
import picomatch from 'picomatch';
import type { DocRead, DocStat, DocsScope, ProjectDocsReader } from '@devdigest/shared';

/** Directory names never descended into, at any depth. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git']);

/** fs error codes that mean "no such readable document" rather than an I/O failure. */
const NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR', 'ENAMETOOLONG', 'ELOOP']);

/**
 * Reads `.md` files from a repo clone for project context. Security boundary:
 * the path is attacker-influenced (repo content / model), so every read is
 * confined to the realpath'd clone root; symlinks that leave it are ignored.
 * Deliberately does NOT use `GitClient.readFile` (no traversal guard).
 */
export class FsProjectDocsReader implements ProjectDocsReader {
  async scan(clonePath: string, scope: DocsScope): Promise<DocStat[]> {
    const root = await realpath(clonePath);
    const isMatch = picomatch(scope.glob, { dot: true });
    const found = new Map<string, DocStat>();

    for (const rootRel of scope.roots) {
      const start = resolve(root, rootRel);
      if (start !== root && !start.startsWith(root + sep)) continue;
      let startReal: string;
      try {
        startReal = await realpath(start);
      } catch {
        continue;
      }
      if (startReal !== root && !startReal.startsWith(root + sep)) continue;
      await this.walk(root, startReal, isMatch, found);
    }
    return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  private async walk(
    root: string,
    dir: string,
    isMatch: (p: string) => boolean,
    out: Map<string, DocStat>,
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name)) continue;
        await this.walk(root, abs, isMatch, out);
        continue;
      }
      if (!e.name.endsWith('.md')) continue;
      if (!e.isFile() && !e.isSymbolicLink()) continue;
      const rel = abs.slice(root.length + 1).split(sep).join('/');
      if (out.has(rel) || !isMatch(rel)) continue;
      try {
        if (e.isSymbolicLink()) {
          const real = await realpath(abs);
          if (!real.startsWith(root + sep)) continue;
        }
        const st = await stat(abs);
        if (!st.isFile()) continue;
        out.set(rel, { path: rel, size_bytes: st.size, mtime_ms: Math.floor(st.mtimeMs) });
      } catch {
        continue;
      }
    }
  }

  async read(
    clonePath: string,
    path: string,
    scope: DocsScope & { maxBytes: number },
  ): Promise<DocRead> {
    const notFound: DocRead = { kind: 'not_found' };
    if (!path || path.includes('\0') || isAbsolute(path) || path.startsWith('/')) return notFound;
    const norm = posix.normalize(path.replace(/\\/g, '/'));
    const segs = norm.split('/');
    if (segs.some((s) => s === '..' || EXCLUDED_DIRS.has(s))) return notFound;
    if (!norm.endsWith('.md') || !picomatch(scope.glob, { dot: true })(norm)) return notFound;

    try {
      const root = await realpath(clonePath);
      const real = await realpath(resolve(root, norm));
      if (!real.startsWith(root + sep)) return notFound;
      // A symlinked dir may resolve into an excluded dir inside the clone.
      if (real.slice(root.length + 1).split(sep).some((s) => EXCLUDED_DIRS.has(s))) return notFound;
      const st = await stat(real);
      if (!st.isFile()) return notFound;
      if (st.size > scope.maxBytes) return { kind: 'too_large', size_bytes: st.size };
      const bytes = await readFile(real);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { kind: 'ok', text, size_bytes: bytes.byteLength };
      } catch {
        return { kind: 'not_text' };
      }
    } catch (err) {
      // A path through a file, an over-long segment or a symlink loop is "not there", not a failure.
      const code = (err as NodeJS.ErrnoException).code;
      if (code && NOT_FOUND_CODES.has(code)) return notFound;
      throw err;
    }
  }
}
