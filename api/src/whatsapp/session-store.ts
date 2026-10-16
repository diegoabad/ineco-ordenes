import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { useMultiFileAuthState } from "@whiskeysockets/baileys";

export class BaileysSessionStore {
  constructor(private readonly sessionPath: string) {}

  async ensureDirectory(): Promise<void> {
    await mkdir(this.sessionPath, { recursive: true });
  }

  async loadAuthState(): Promise<Awaited<ReturnType<typeof useMultiFileAuthState>>> {
    await this.ensureDirectory();
    return useMultiFileAuthState(this.sessionPath);
  }

  async hasSession(): Promise<boolean> {
    try {
      const files = await readdir(this.sessionPath);
      return files.some((file) => file.startsWith("creds"));
    } catch {
      return false;
    }
  }

  async validateSession(): Promise<boolean> {
    try {
      const files = await readdir(this.sessionPath);
      const credsFile = files.find((file) => file.startsWith("creds"));
      if (!credsFile) return false;
      const raw = await readFile(path.join(this.sessionPath, credsFile), "utf8");
      const parsed = JSON.parse(raw) as { me?: { id?: string } | null };
      return Boolean(parsed.me?.id);
    } catch {
      return false;
    }
  }

  async clearSession(): Promise<void> {
    await rm(this.sessionPath, { recursive: true, force: true });
    await this.ensureDirectory();
  }
}
