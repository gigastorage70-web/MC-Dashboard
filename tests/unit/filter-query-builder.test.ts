import { describe, expect, it } from "vitest";
import { DEFAULT_GLOBAL_FILTER } from "../../src/modules/analytics/filter-schema";
import { buildAnalyticsWhere } from "../../src/modules/analytics/query-builder";

describe("Centralized Analytics Filter Query Builder", () => {
  it("builds DuckDB parameterized list_contains queries on rollup by default", () => {
    const res = buildAnalyticsWhere(
      {
        ...DEFAULT_GLOBAL_FILTER,
        countries: ["Iran", "Cote d'Ivoire"],
        opNames: ["Route Trade - C - Direct New"],
        normalizedStatuses: ["REJECTED"],
      },
      { engine: "duckdb" }
    );

    expect(res.engine).toBe("duckdb");
    expect(res.useRawTable).toBe(false);
    expect(res.timeColumn).toBe("bucket_hour");
    expect(res.whereSql).toContain("list_contains($countries, country)");
    expect(res.whereSql).toContain("list_contains($opNames, op_name)");
    expect(res.whereSql).not.toContain("Iran");
    expect(res.queryParams.countries).toEqual(["Iran", "Cote d'Ivoire"]);
  });

  it("builds ClickHouse parameterized queries when ClickHouse engine is selected", () => {
    const res = buildAnalyticsWhere(
      {
        ...DEFAULT_GLOBAL_FILTER,
        countries: ["Iran"],
        opAnis: ["Facebook"],
        searchQuery: "98911",
      },
      { engine: "clickhouse" }
    );

    expect(res.engine).toBe("clickhouse");
    expect(res.useRawTable).toBe(true);
    expect(res.timeColumn).toBe("event_timestamp");
    expect(res.whereSql).toContain("country IN {countries:Array(String)}");
    expect(res.whereSql).toContain("op_ani IN {opAnis:Array(String)}");
    expect(res.whereSql).toContain("positionCaseInsensitive");
  });

  it("excludes target dimension when building dependent filter facet queries", () => {
    const res = buildAnalyticsWhere(
      {
        ...DEFAULT_GLOBAL_FILTER,
        countries: ["Iran"],
        tpNames: ["Boldtel - V - Direct"],
      },
      { excludeDimension: "tpNames", engine: "duckdb" }
    );

    expect(res.whereSql).toContain("list_contains($countries, country)");
    expect(res.whereSql).not.toContain("tp_name");
  });
});
