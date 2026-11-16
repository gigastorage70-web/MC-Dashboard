"use client";

import { DimensionAnalyticsView } from "@/components/analytics/DimensionAnalyticsView";

export default function RejectionIntelligencePage() {
  return (
    <DimensionAnalyticsView
      title="Message Status & Rejection Intelligence"
      subtitle="Analyze raw SMPP codes, DLR states, and normalized rejection reasons without merging distinct technical errors."
      dimension="raw_status"
      filterKey="rawStatuses"
      secondaryTabs={[
        { label: "Raw Status / SMPP Code", dimension: "raw_status", filterKey: "rawStatuses" },
        { label: "Normalized Reason", dimension: "reason", filterKey: "reasons" },
      ]}
    />
  );
}
