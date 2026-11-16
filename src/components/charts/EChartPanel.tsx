"use client";

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { EChartsOption } from "echarts";

interface EChartPanelProps {
  option: EChartsOption;
  height?: number;
  onPointClick?: (name: string) => void;
}

export function EChartPanel({
  option,
  height = 300,
  onPointClick,
}: EChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = echarts.init(containerRef.current);
    chartRef.current = instance;

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const isDark = document.documentElement.classList.contains("dark");
    chart.setOption(
      {
        backgroundColor: "transparent",
        textStyle: {
          color: isDark ? "#cbd5e1" : "#334155",
          fontFamily: "Inter, sans-serif",
          fontSize: 11,
        },
        ...option,
      },
      { notMerge: true }
    );

    chart.off("click");
    if (onPointClick) {
      chart.on("click", (params) => {
        if (typeof params.name === "string" && params.name) {
          onPointClick(params.name);
        }
      });
    }
  }, [option, onPointClick]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
