import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

import { LIMITS } from "./constants.js";
import { PatrolError } from "./errors.js";

export interface ReadResult {
  content: string;
  size: number;
  digest: string;
  skipped: false;
}

export interface SkipResult {
  content: null;
  size: number;
  skipped: true;
  reason: "too-large" | "binary" | "not-a-file" | "read-error";
}

export type SourceRead = ReadResult | SkipResult;

/**
 * Read a regular file without following a symlink (O_NOFOLLOW), bounded to
 * `maxFileBytes`, detect binary content or growth during the read, and hash
 * the raw bytes (not the UTF-8 decoded text) for identity purposes.
 */
export async function readSource(
  path: string,
  maxFileBytes = LIMITS.maxFileBytes,
): Promise<SourceRead> {
  let handle: FileHandle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return { content: null, size: 0, skipped: true, reason: "read-error" };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { content: null, size: info.size, skipped: true, reason: "not-a-file" };
    }
    if (info.size > maxFileBytes) {
      return { content: null, size: info.size, skipped: true, reason: "too-large" };
    }
    const buf = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < info.size) {
      const { bytesRead } = await handle.read(buf, offset, info.size - offset, offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== info.size || after.ino !== info.ino) {
      throw new PatrolError("SOURCE_CHANGED", "file changed while reading");
    }
    if (offset !== info.size) {
      throw new PatrolError("SOURCE_CHANGED", "short read while reading");
    }
    if (buf.includes(0)) {
      return { content: null, size: info.size, skipped: true, reason: "binary" };
    }
    const digest = createHash("sha256").update(buf).digest("hex");
    return {
      content: buf.toString("utf8"),
      size: info.size,
      digest,
      skipped: false,
    };
  } catch (err) {
    if (err instanceof PatrolError) {
      throw err;
    }
    return { content: null, size: 0, skipped: true, reason: "read-error" };
  } finally {
    await handle.close().catch(() => {});
  }
}
