"use client";

import { DimensionAnalyticsView } from "@/components/analytics/DimensionAnalyticsView";

export default function OpAnalyticsPage() {
  return (
    <DimensionAnalyticsView
      title="OP-Wise Performance Analytics"
      subtitle="Originating Partner traffic volume, delivery vs rejection rates, failure contribution, and drill-down."
      dimension="op"
      filterKey="opNames"
      secondaryTabs={[
        { label: "By OP", dimension: "op", filterKey: "opNames" },
        { label: "Associated TPs", dimension: "tp", filterKey: "tpNames" },
        { label: "By Route / Dialpeer", dimension: "route", filterKey: "routes" },
      ]}
    />
  );
}
