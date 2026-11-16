"use client";

import { DimensionAnalyticsView } from "@/components/analytics/DimensionAnalyticsView";

export default function ApplicantAnalyticsPage() {
  return (
    <DimensionAnalyticsView
      title="Applicant Performance Analytics"
      subtitle="Dedicated applicant QoS tracking kept strictly separate from Termination Provider (TP) metrics."
      dimension="applicant"
      filterKey="applicants"
    />
  );
}
