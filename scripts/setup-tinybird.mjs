import fs from "node:fs";
import path from "node:path";

function loadEnvFileIfPresent(filename) {
  const full = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(full)) return;
  const content = fs.readFileSync(full, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

loadEnvFileIfPresent(".env.local");
loadEnvFileIfPresent(".env");

const apiUrl = (process.env.TINYBIRD_API_URL || "https://api.tinybird.co").replace(/\/+$/, "");
const token = process.env.TINYBIRD_TOKEN?.trim();

if (!token) {
  console.error(
    "Missing TINYBIRD_TOKEN. Sign up free at https://cloud.tinybird.co, copy your admin token + regional host (e.g. https://api.tinybird.co or https://api.us-east.tinybird.co), set TINYBIRD_TOKEN and TINYBIRD_API_URL in .env, and re-run npm run tinybird:setup."
  );
  process.exit(1);
}

function parseDatasourceFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const name = path.basename(filePath, ".datasource");

  const descMatch = /DESCRIPTION\s*>\s*(.+)/.exec(text);
  const schemaMatch = /SCHEMA\s*>\s*([\s\S]*?)\n\s*ENGINE\b/.exec(text);
  const engineMatch = /ENGINE\s+"([^"]+)"/.exec(text);
  const partitionMatch = /ENGINE_PARTITION_KEY\s+"([^"]+)"/.exec(text);
  const sortMatch = /ENGINE_SORTING_KEY\s+"([^"]+)"/.exec(text);

  if (!schemaMatch) {
    throw new Error(`Could not parse SCHEMA block in ${filePath}`);
  }

  return {
    name,
    raw: text,
    description: descMatch ? descMatch[1].trim() : "",
    schema: schemaMatch[1]
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" "),
    engine: engineMatch ? engineMatch[1] : "MergeTree",
    engine_partition_key: partitionMatch ? partitionMatch[1] : undefined,
    engine_sorting_key: sortMatch ? sortMatch[1] : undefined,
  };
}

async function main() {
  const listRes = await fetch(`${apiUrl}/v0/datasources`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    throw new Error(
      `Tinybird auth check failed (HTTP ${listRes.status}): ${await listRes.text()}`
    );
  }
  const existingJson = await listRes.json();
  const existingNames = new Set((existingJson.datasources || []).map((d) => d.name));

  const dsDir = path.resolve(process.cwd(), "tinybird/datasources");
  const files = fs
    .readdirSync(dsDir)
    .filter((f) => f.endsWith(".datasource"))
    .sort();

  for (const file of files) {
    const spec = parseDatasourceFile(path.join(dsDir, file));
    if (existingNames.has(spec.name)) {
      console.log(`[tinybird:setup] "${spec.name}" already exists.`);
      continue;
    }

    const params = new URLSearchParams({
      name: spec.name,
      mode: "create",
      format: "ndjson",
      schema: spec.schema,
      engine: spec.engine,
    });
    if (spec.description) params.set("description", spec.description);
    if (spec.engine_partition_key) {
      params.set("engine_partition_key", spec.engine_partition_key);
    }
    if (spec.engine_sorting_key) {
      params.set("engine_sorting_key", spec.engine_sorting_key);
    }

    const createRes = await fetch(`${apiUrl}/v0/datasources`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(
        `Failed to create "${spec.name}" via API (HTTP ${createRes.status}): ${errText}\nIf your workspace uses Tinybird Forward deployment mode, install the Tinybird CLI and run: tb --cloud deploy`
      );
    }

    console.log(`[tinybird:setup] Created "${spec.name}" successfully.`);
  }

  console.log("[tinybird:setup] All Tinybird Data Sources are ready.");
}

main().catch((err) => {
  console.error("[tinybird:setup]", err instanceof Error ? err.message : err);
  process.exit(1);
});
