import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "../../src/lib/config/env";
import {
  deleteStorageKeys,
  deleteStoragePrefix,
  listStorageObjects,
} from "../../src/lib/storage";

describe("Storage listing and prefix cleanup safety", () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    resetEnvCache();
    for (const d of createdDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    createdDirs.length = 0;
  });

  it("rejects unsafe storage prefix deletions outside uploads/ and error-reports/", async () => {
    await expect(deleteStoragePrefix("mc-csv-uploads", "")).rejects.toThrow(
      /Unsafe storage prefix/
    );
    await expect(deleteStoragePrefix("mc-csv-uploads", "other/")).rejects.toThrow(
      /Unsafe storage prefix/
    );
  });

  it("lists and deletes dataset files cleanly on local storage mode", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-storage-test-"));
    createdDirs.push(tmpDir);
    process.env.STORAGE_PROVIDER = "local";
    process.env.LOCAL_STORAGE_DIR = tmpDir;

    const dsId = "11111111-2222-3333-4444-555555555555";
    const fileA = path.join(tmpDir, "uploads", dsId, "sample.csv");
    const fileB = path.join(tmpDir, "error-reports", dsId, "err.csv");
    fs.mkdirSync(path.dirname(fileA), { recursive: true });
    fs.mkdirSync(path.dirname(fileB), { recursive: true });
    fs.writeFileSync(fileA, "a,b\n1,2\n");
    fs.writeFileSync(fileB, "err\n");

    const listed = await listStorageObjects("mc-csv-uploads");
    expect(listed.map((o) => o.key).sort()).toEqual([
      `error-reports/${dsId}/err.csv`,
      `uploads/${dsId}/sample.csv`,
    ]);

    const removedUploads = await deleteStoragePrefix(
      "mc-csv-uploads",
      `uploads/${dsId}/`
    );
    expect(removedUploads).toBe(1);

    const removedErrors = await deleteStorageKeys("mc-csv-uploads", [
      `error-reports/${dsId}/err.csv`,
    ]);
    expect(removedErrors).toBe(1);

    const after = await listStorageObjects("mc-csv-uploads");
    expect(after).toEqual([]);
  });
});
