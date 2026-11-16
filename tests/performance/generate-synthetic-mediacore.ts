/**
 * Streaming Synthetic MediaCore CSV Generator (100K to 10M rows) for load/performance benchmarking.
 * Run: npx tsx tests/performance/generate-synthetic-mediacore.ts --rows 1000000 --out tmp/bench_1m.csv
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const rowsFlagIdx = args.indexOf("--rows");
const outFlagIdx = args.indexOf("--out");

const totalRows = rowsFlagIdx >= 0 ? Number(args[rowsFlagIdx + 1]) : 100_000;
const outPath =
  outFlagIdx >= 0
    ? path.resolve(args[outFlagIdx + 1])
    : path.resolve("tmp", `synthetic_${totalRows}.csv`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const stream = fs.createWriteStream(outPath, { encoding: "utf8" });

const HEADER =
  "OP Name;TP Name;Send Time;Clear Number;Called Number OUT;Country;OP MCC;OP MNC;TP MCC;TP MNC;OP ANI;TP ANI;Status;DLR;DLR time;State;OP Price;TP Price;Cost IN;Cost OUT;OP Host;TP Host;NAS IP;Dialpeer;Message ID;OP Currency;TP Currency\n";

const OPS = ["Route Trade - C - Direct New", "Mobi Bahrain - C - Direct", "Oak - C - Direct", "Text Telecom - C - Direct"];
const TPS = ["Innovatio - V - Direct", "Boldtel - V - Direct", "A2P Ltd - V - Direct", "Kaarai - V - OTP"];
const COUNTRIES = [
  ["Iran Mobile Communications Company of Iran (TCI)", "432", "11"],
  ["Cote Divoire mobile Orange CI", "612", "03"],
  ["Sierra Leone mobile Airtel", "619", "01"],
  ["Colombia mobile Claro", "732", "101"],
];
const ANIS = ["FACEBOOK", "Apple", "WhatsApp", "Ourbit", "0123456789"];
const ROUTES = ["A-Z Route Trade Com", "Routing_Ivory Coast_SD", "Routing_Sierra_Leone_SD", "Routing_Colombia_OTP"];

async function generate() {
  stream.write(HEADER);
  const baseMs = Date.UTC(2026, 10, 13, 0, 0, 0);

  for (let i = 0; i < totalRows; i++) {
    const op = OPS[i % OPS.length];
    const tp = TPS[(i * 3) % TPS.length];
    const [country, mcc, mnc] = COUNTRIES[i % COUNTRIES.length];
    const ani = ANIS[i % ANIS.length];
    const route = ROUTES[i % ROUTES.length];

    const ts = new Date(baseMs + i * 8).toISOString().replace("T", " ").replace("Z", "000");
    const isRejected = i % 10 < 5;
    const isFailed = !isRejected && i % 25 === 0;
    const status = isRejected ? (i % 2 === 0 ? "69" : "11") : "";
    const state = isRejected ? "" : isFailed ? "UNDELIV" : "DELIVRD";
    const dlrTime = isRejected
      ? ""
      : new Date(baseMs + i * 8 + 3200).toISOString().replace("T", " ").replace("Z", "000");
    const msgId = isRejected ? "" : `msg-${i}`;

    const line = `${op};${tp};${ts};98911${1000000 + (i % 9000000)};98911${1000000 + (i % 9000000)};${country};${mcc};${mnc};${mcc};${mnc};${ani};${ani};${status};1;${dlrTime};${state};0.03700;0.02500;0.03700;${isRejected ? "" : "0.02500"};194.28.164.91;65.21.141.225;194.28.164.27;${route};${msgId};EUR;EUR\n`;
    if (!stream.write(line)) {
      await new Promise<void>((r) => stream.once("drain", () => r()));
    }
  }

  await new Promise<void>((r) => stream.end(() => r()));
  console.log(`Generated ${totalRows} synthetic MediaCore XDR rows at ${outPath}`);
}

void generate();
