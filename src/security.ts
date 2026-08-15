export function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Reject paths that could escape the workspace or are otherwise unsafe.
 * Accepts only relative POSIX paths without traversal, absolute prefix, or
 * control characters.
 */
export function canonicalizePath(input: string): string | null {
  if (input.length === 0) {
    return null;
  }
  if (input.includes("\0")) {
    return null;
  }
  const path = toPosix(input.trim());
  if (path.startsWith("/")) {
    return null;
  }
  if (/^[a-zA-Z]:/.test(path)) {
    return null;
  }
  const segments = path.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return null;
    }
    out.push(segment);
  }
  if (out.length === 0) {
    return null;
  }
  return out.join("/");
}

export function isDenied(path: string, patterns: readonly string[]): boolean {
  const posix = toPosix(path);
  const segments = posix.split("/");
  for (const pattern of patterns) {
    const normalized = toPosix(pattern);
    if (normalized.includes("/")) {
      if (matchGlob(posix, normalized)) {
        return true;
      }
    } else {
      for (const segment of segments) {
        if (matchGlob(segment, normalized)) {
          return true;
        }
      }
    }
  }
  return false;
}

function matchGlob(target: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(target);
}

function globToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else {
      out += escapeRegex(ch as string);
    }
  }
  return new RegExp(`^${out}$`, "i");
}

function escapeRegex(ch: string): string {
  return /[.+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

// ---------------------------------------------------------------------------
// Redaction (defense in depth; never a proof of absence)
// ---------------------------------------------------------------------------

const WHOLE_SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

const ASSIGNMENT_PATTERN =
  /(password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key)\s*[:=]\s*["']?[^\s"'`,;}\]]{4,}/gi;

export function redact(text: string): string {
  let out = text;
  for (const pattern of WHOLE_SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  out = out.replace(ASSIGNMENT_PATTERN, (match) => {
    const key = match.match(/^[^:=]+/)?.[0] ?? "";
    return `${key}[REDACTED]`;
  });
  return out;
}
