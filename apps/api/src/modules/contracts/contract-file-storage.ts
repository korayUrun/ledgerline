import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiConfig } from "../../config.js";
import { CONFIG } from "../../common/tokens.js";

export const MAX_CONTRACT_BYTES = 10 * 1024 * 1024;

// Contract PDFs on the local disk, the same way receipts are stored. The API
// writes the file, the worker reads it: both get the same storageDir from config.
@Injectable()
export class ContractFileStorage {
  constructor(@Inject(CONFIG) private readonly config: ApiConfig) {}

  // The key is generated here, never taken from the uploaded file name, so the
  // name cannot choose where the file is written ("../../etc/passwd").
  async save(content: Buffer): Promise<string> {
    const key = `contracts/${randomUUID()}.pdf`;
    const filePath = path.join(this.config.storageDir, key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return key;
  }

  read(key: string): Promise<Buffer> {
    return readFile(path.join(this.config.storageDir, key));
  }
}

// Checked on the bytes, not only the declared type: a browser or a script can
// label any file "application/pdf". Every PDF starts with "%PDF-".
export function looksLikePdf(content: Buffer): boolean {
  return content.subarray(0, 5).toString("latin1") === "%PDF-";
}
