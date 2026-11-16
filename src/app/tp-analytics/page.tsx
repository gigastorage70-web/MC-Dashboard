"use client";

import { DimensionAnalyticsView } from "@/components/analytics/DimensionAnalyticsView";

export default function TpAnalyticsPage() {
  return (
    <DimensionAnalyticsView
      title="TP / Termination Provider Analytics"
      subtitle="Provider acceptance vs rejection, delivery performance, route efficiency, and failure contribution."
      dimension="tp"
      filterKey="tpNames"
      secondaryTabs={[
        { label: "By TP / Provider", dimension: "tp", filterKey: "tpNames" },
        { label: "By Route / Dialpeer", dimension: "route", filterKey: "routes" },
        { label: "By Country", dimension: "country", filterKey: "countries" },
      ]}
    />
  );
}
