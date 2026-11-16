import { z } from "zod";

export const NormalizedStatusEnum = z.enum([
  "SUCCESS",
  "FAILED",
  "REJECTED",
  "PENDING",
  "OTHER",
  "UNKNOWN",
]);

export const GlobalFilterSchema = z.object({
  datasetIds: z.array(z.string().uuid()).default([]),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  opNames: z.array(z.string().min(1)).default([]),
  tpNames: z.array(z.string().min(1)).default([]),
  opAnis: z.array(z.string().min(1)).default([]),
  tpAnis: z.array(z.string().min(1)).default([]),
  countries: z.array(z.string().min(1)).default([]),
  states: z.array(z.string().min(1)).default([]),
  rawStatuses: z.array(z.string().min(1)).default([]),
  normalizedStatuses: z.array(NormalizedStatusEnum).default([]),
  reasons: z.array(z.string().min(1)).default([]),
  applicants: z.array(z.string().min(1)).default([]),
  directions: z.array(z.string().min(1)).default([]),
  routes: z.array(z.string().min(1)).default([]),
  searchQuery: z.string().max(200).optional(),
});

export type GlobalFilterSpec = z.infer<typeof GlobalFilterSchema>;

export const DEFAULT_GLOBAL_FILTER: GlobalFilterSpec = {
  datasetIds: [],
  opNames: [],
  tpNames: [],
  opAnis: [],
  tpAnis: [],
  countries: [],
  states: [],
  rawStatuses: [],
  normalizedStatuses: [],
  reasons: [],
  applicants: [],
  directions: [],
  routes: [],
};
