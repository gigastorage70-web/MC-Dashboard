"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  DEFAULT_GLOBAL_FILTER,
  type GlobalFilterSpec,
} from "@/modules/analytics/filter-schema";

export interface DatasetOption {
  id: string;
  name: string;
  status: string;
  coverage_start: string | null;
  coverage_end: string | null;
  valid_rows: number;
  available_dimensions: string[];
}

interface FilterContextValue {
  filter: GlobalFilterSpec;
  setFilter: React.Dispatch<React.SetStateAction<GlobalFilterSpec>>;
  resetFilters: () => void;
  toggleArrayValue: (
    key: Exclude<keyof GlobalFilterSpec, "dateFrom" | "dateTo" | "searchQuery">,
    val: string
  ) => void;
  datasets: DatasetOption[];
  refreshDatasets: () => Promise<void>;
}

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilter] = useState<GlobalFilterSpec>(DEFAULT_GLOBAL_FILTER);
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);

  const refreshDatasets = useCallback(async () => {
    try {
      const res = await fetch("/api/datasets", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { datasets: DatasetOption[] };
      const list = data.datasets ?? [];
      setDatasets(list);
      const validIds = new Set(list.map((d) => d.id));
      setFilter((prev) => {
        if (prev.datasetIds.length === 0) return prev;
        const nextIds = prev.datasetIds.filter((id) => validIds.has(id));
        if (nextIds.length === prev.datasetIds.length) return prev;
        return { ...prev, datasetIds: nextIds };
      });
    } catch {
      // ignore if unauthenticated or DB booting
    }
  }, []);

  useEffect(() => {
    // Restore shareable URL filter state if present
    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("f");
    if (encoded) {
      try {
        const parsed = JSON.parse(atob(encoded)) as Partial<GlobalFilterSpec>;
        setFilter((prev) => ({ ...prev, ...parsed }));
      } catch {
        // ignore invalid filter query
      }
    }
    void refreshDatasets();
  }, [refreshDatasets]);

  const resetFilters = useCallback(() => {
    setFilter(DEFAULT_GLOBAL_FILTER);
  }, []);

  const toggleArrayValue = useCallback(
    (
      key: Exclude<keyof GlobalFilterSpec, "dateFrom" | "dateTo" | "searchQuery">,
      val: string
    ) => {
      setFilter((prev) => {
        const current = prev[key] as string[];
        const exists = current.includes(val);
        const next = exists
          ? current.filter((v) => v !== val)
          : [...current, val];
        return { ...prev, [key]: next };
      });
    },
    []
  );

  return (
    <FilterContext.Provider
      value={{
        filter,
        setFilter,
        resetFilters,
        toggleArrayValue,
        datasets,
        refreshDatasets,
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useGlobalFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) {
    throw new Error("useGlobalFilters must be used inside FilterProvider");
  }
  return ctx;
}
