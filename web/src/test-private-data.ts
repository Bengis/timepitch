// Test-only helpers for inputs that are not distributed with the public repository
// (private recordings, research captures). When the input is absent the running test is
// reported as skipped with a reason, instead of failing.
import { TestRunner } from 'vitest';

const env = (globalThis as typeof globalThis & { process?: { env: Record<string, string | undefined> } }).process?.env;

export function skipPrivate(what: string): never {
  const reason = `private dataset not distributed: ${what}`;
  TestRunner.getCurrentTest()?.context?.skip(reason);
  throw new Error(reason);
}

/** Returns the environment variable or skips the running test. */
export function requirePrivateEnv(name: string): string {
  const value = env?.[name];
  return value ? value : skipPrivate(name);
}

/** Reads a repository-relative research file (relative to `web/`), or skips the running test. */
export function readPrivateFile(fs: { existsSync: (p: string) => boolean; readFileSync: (p: string, e: 'utf8') => string }, path: string): string {
  return fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : skipPrivate(path);
}
