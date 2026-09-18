import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class MediaStorage {
  constructor(private readonly rootDir: string) {}

  async ensureDirectory(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
  }

  async save(buffer: Buffer, opts?: { mimeType?: string | null; fileName?: string | null }): Promise<{
    absolutePath: string;
    relativePath: string;
    fileName: string;
  }> {
    await this.ensureDirectory();
    const ext = extensionFromMime(opts?.mimeType) || extensionFromName(opts?.fileName) || "bin";
    const safeBase = (opts?.fileName || `media-${randomUUID()}`)
      .replace(/[^\w.\-]+/g, "_")
      .slice(0, 80);
    const fileName = safeBase.includes(".") ? safeBase : `${safeBase}.${ext}`;
    const relativePath = path.join(new Date().toISOString().slice(0, 10), `${randomUUID()}-${fileName}`);
    const absolutePath = path.join(this.rootDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return { absolutePath, relativePath: relativePath.replace(/\\/g, "/"), fileName };
  }

  resolve(relativePath: string): string {
    return path.join(this.rootDir, relativePath);
  }
}

function extensionFromMime(mime?: string | null): string {
  if (!mime) return "";
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[mime.toLowerCase()] ?? "";
}

function extensionFromName(name?: string | null): string {
  if (!name?.includes(".")) return "";
  return name.split(".").pop()?.toLowerCase() ?? "";
}
