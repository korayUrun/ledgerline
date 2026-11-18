import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiConfig } from "../../config.js";
import { CONFIG } from "../../common/tokens.js";

// File type → extension. Anything else is rejected before it touches the disk.
export const RECEIPT_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// Receipts on the local disk (Phase 2 scope). The database stores only the key, so
// moving to S3 later means changing this class, not the data.
@Injectable()
export class ReceiptStorage {
  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {}

  async save(content: Buffer, mimeType: string): Promise<string> {
    const extension = RECEIPT_TYPES[mimeType];
    if (!extension) {
      throw new Error(`Unsupported receipt type ${mimeType}`);
    }
    // The key is generated here, never taken from the uploaded file name, so a
    // name like "../../etc/passwd" can never choose where the file is written.
    const key = `receipts/${randomUUID()}${extension}`;
    const filePath = path.join(this.config.storageDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(path.join(this.config.storageDir, key));
  }

  contentTypeOf(key: string): string {
    const entry = Object.entries(RECEIPT_TYPES).find(([, extension]) => key.endsWith(extension));
    return entry?.[0] ?? "application/octet-stream";
  }
}
