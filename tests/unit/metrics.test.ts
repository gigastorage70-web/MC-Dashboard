import { describe, expect, it } from "vitest";
import {
  classifyMediaCoreStatus,
  computeFailureContributionPct,
  computeQoSKpis,
  computeTrafficSharePct,
  sanitizeCsvCell,
} from "../../src/lib/metrics/definitions";

describe("MediaCore Dual-Stage Status Classification", () => {
  it("classifies empty submit status + DELIVRD as SUCCESS (terminal)", () => {
    const res = classifyMediaCoreStatus("", "DELIVRD");
    expect(res.normalizedStatus).toBe("SUCCESS");
    expect(res.isTerminal).toBe(true);
    expect(res.rawStatus).toBe("DELIVRD");
  });

  it("classifies submit SMPP codes (69, 11, 88) as REJECTED (terminal)", () => {
    for (const code of ["69", "11", "88"]) {
      const res = classifyMediaCoreStatus(code, "");
      expect(res.normalizedStatus).toBe("REJECTED");
      expect(res.isTerminal).toBe(true);
      expect(res.rawStatus).toBe(`SMPP:${code}`);
    }
  });

  it("classifies UNDELIV and EXPIRED DLR states as FAILED (terminal)", () => {
    expect(classifyMediaCoreStatus("", "UNDELIV").normalizedStatus).toBe("FAILED");
    expect(classifyMediaCoreStatus("", "EXPIRED").normalizedStatus).toBe("FAILED");
  });

  it("classifies ENROUTE as non-terminal PENDING and blank/blank as UNKNOWN", () => {
    const enroute = classifyMediaCoreStatus("", "ENROUTE");
    expect(enroute.normalizedStatus).toBe("PENDING");
    expect(enroute.isTerminal).toBe(false);

    const unknown = classifyMediaCoreStatus("", "");
    expect(unknown.normalizedStatus).toBe("UNKNOWN");
    expect(unknown.isTerminal).toBe(false);
  });
});

describe("Centralized QoS KPI Calculations", () => {
  it("excludes pending and unknown rows from terminal rate denominators and avoids double counting", () => {
    const kpis = computeQoSKpis({
      totalMessages: 1100,
      successMessages: 700,
      failedMessages: 100,
      rejectedMessages: 200,
      pendingMessages: 50,
      unknownMessages: 50,
      otherMessages: 0,
    });

    expect(kpis.terminalMessages).toBe(1000);
    expect(kpis.unsuccessfulCombinedMessages).toBe(300);
    expect(kpis.successRatePct).toBe(70);
    expect(kpis.failureRatePct).toBe(10);
    expect(kpis.rejectionRatePct).toBe(20);
    expect(kpis.combinedUnsuccessfulRatePct).toBe(30);
  });

  it("returns null (for UI N/A display) when denominator is 0", () => {
    const kpis = computeQoSKpis({
      totalMessages: 25,
      successMessages: 0,
      failedMessages: 0,
      rejectedMessages: 0,
      pendingMessages: 25,
      unknownMessages: 0,
      otherMessages: 0,
    });

    expect(kpis.successRatePct).toBeNull();
    expect(kpis.failureRatePct).toBeNull();
    expect(computeFailureContributionPct(10, 0)).toBeNull();
    expect(computeTrafficSharePct(10, 0)).toBeNull();
  });

  it("protects CSV export cells against formula injection", () => {
    expect(sanitizeCsvCell("=CMD('calc')")).toBe("'=CMD('calc')");
    expect(sanitizeCsvCell("+123456")).toBe("'+123456");
    expect(sanitizeCsvCell("@SUM(A1:A2)")).toBe("'@SUM(A1:A2)");
    expect(sanitizeCsvCell("Normal;Text")).toBe('"Normal;Text"');
  });
});
