"use client";

import { DimensionAnalyticsView } from "@/components/analytics/DimensionAnalyticsView";

export default function GeographicAnalyticsPage() {
  return (
    <DimensionAnalyticsView
      title="Geographic & Carrier Performance"
      subtitle="Country and State/Region delivery performance. Unknown locations are explicitly preserved as Unmapped."
      dimension="country"
      filterKey="countries"
      secondaryTabs={[
        { label: "By Country", dimension: "country", filterKey: "countries" },
        { label: "By State / Region", dimension: "state", filterKey: "states" },
      ]}
    />
  );
}
