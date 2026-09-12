"use client";

import { useMemo, useState } from "react";
import type { ReportMetrics } from "@/lib/reports/metrics";
import { formatCurrencyMinor } from "@/lib/financial/money";

const ranges = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

function money(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, { explicitCode: currency !== "MYR" });
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return "";
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]!;
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0]!.x} ${points[0]!.y}`);
}

export function ReceivablesPulse({ metrics, compact = false }: { metrics: ReportMetrics; compact?: boolean }) {
  const currency = metrics.currencies[0] ?? "MYR";
  const [range, setRange] = useState<(typeof ranges)[number]>(compact ? ranges[1] : ranges[1]);
  const chart = useMemo(() => {
    const values = metrics.outstandingTrend.slice(-(range.days + 1));
    const width = 760;
    const height = compact ? 150 : 245;
    const top = 14;
    const bottom = compact ? 24 : 34;
    const amounts = values.map((item) => item.outstandingMinor);
    const min = Math.min(...amounts, 0);
    const max = Math.max(...amounts, 1);
    const spread = Math.max(1, max - min);
    const points = values.map((item, index) => ({
      date: item.date,
      amount: item.outstandingMinor,
      x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
      y: top + ((max - item.outstandingMinor) / spread) * (height - top - bottom),
    }));
    const path = smoothPath(points);
    const first = values[0]?.outstandingMinor ?? metrics.totalOutstandingMinor;
    const absolute = metrics.totalOutstandingMinor - first;
    const percentage = first === 0 ? null : Math.round((absolute / first) * 10_000) / 100;
    const events = metrics.pulseEvents
      .filter((event) => event.date >= (values[0]?.date ?? metrics.asOfDate))
      .sort((left, right) => right.amountMinor - left.amountMinor)
      .slice(0, compact ? 3 : 8)
      .map((event) => {
        const index = Math.max(0, values.findIndex((item) => item.date >= event.date));
        return { ...event, point: points[index] ?? points.at(-1) };
      });
    return { values, width, height, min, max, points, path, absolute, percentage, events };
  }, [compact, metrics, range]);

  const changeUp = chart.absolute > 0;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby={compact ? "mobile-pulse-title" : "receivables-pulse-title"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p id={compact ? "mobile-pulse-title" : "receivables-pulse-title"} className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Receivables Pulse</p>
          <p className={`${compact ? "text-2xl" : "text-3xl"} mt-1 font-black tracking-tight text-[var(--cb-brand-navy)]`}>{money(metrics.totalOutstandingMinor, currency)}</p>
          <p className={`mt-1 text-xs font-semibold ${chart.absolute === 0 ? "text-slate-500" : changeUp ? "text-red-700" : "text-emerald-700"}`}>
            {chart.absolute > 0 ? "+" : ""}{money(chart.absolute, currency)} {chart.percentage === null ? "" : `(${chart.percentage > 0 ? "+" : ""}${chart.percentage}%)`} over {range.label}
          </p>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1" aria-label="Receivables Pulse period">
          {ranges.map((item) => <button key={item.label} type="button" aria-pressed={range.label === item.label} onClick={() => setRange(item)} className={`min-w-9 rounded-lg px-2 py-1.5 text-[10px] font-bold transition ${range.label === item.label ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>{item.label}</button>)}
        </div>
      </div>

      <div className="mt-3 overflow-hidden">
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} className="h-auto w-full" role="img" aria-label={`Outstanding receivables trend for ${range.label}, from ${money(chart.values[0]?.outstandingMinor ?? 0, currency)} to ${money(metrics.totalOutstandingMinor, currency)}.`}>
          <defs>
            <linearGradient id={`pulse-fill-${compact ? "compact" : "full"}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--cb-chart-3)" stopOpacity="0.22" /><stop offset="100%" stopColor="var(--cb-chart-3)" stopOpacity="0.02" /></linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1="0" x2={chart.width} y1={chart.height * ratio} y2={chart.height * ratio} stroke="var(--cb-chart-grid)" strokeDasharray="4 6" />)}
          {chart.path && <path d={`${chart.path} L ${chart.width} ${chart.height - (compact ? 24 : 34)} L 0 ${chart.height - (compact ? 24 : 34)} Z`} fill={`url(#pulse-fill-${compact ? "compact" : "full"})`} />}
          {chart.path && <path d={chart.path} fill="none" stroke="var(--cb-chart-3)" strokeWidth={compact ? 4 : 3.5} strokeLinecap="round" />}
          {chart.events.map((event, index) => event.point && <g key={`${event.type}-${event.date}-${index}`}>
            <circle cx={event.point.x} cy={event.point.y} r={compact ? 4 : 5} fill={event.type === "recovered" ? "#059669" : event.type === "new_overdue" ? "#EA580C" : event.type === "promise_missed" ? "#DC2626" : "#475569"} stroke="white" strokeWidth="2"><title>{event.label}: {money(event.amountMinor, currency)} on {event.date}</title></circle>
            {!compact && <text x={event.point.x} y={Math.max(10, event.point.y - 10)} textAnchor="middle" fontSize="9" fontWeight="700" fill="#475569">{event.label}</text>}
          </g>)}
          <text x="0" y={chart.height - 5} fontSize="10" fill="#64748B">{chart.values[0]?.date}</text>
          <text x={chart.width} y={chart.height - 5} textAnchor="end" fontSize="10" fill="#64748B">{metrics.asOfDate}</text>
        </svg>
      </div>

      {!compact && <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-semibold text-slate-600" aria-label="Event marker legend">
        <Legend color="#059669" label="Money recovered" /><Legend color="#EA580C" label="New overdue" /><Legend color="#DC2626" label="Promise missed" /><Legend color="#475569" label="Case closed" />
      </div>}
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}

export function DailyActivityBars({ activity, currency = "MYR" }: { activity: ReportMetrics["dailyActivity"]; currency?: string }) {
  const visible = activity.slice(-14);
  const max = Math.max(...visible.flatMap((item) => [Math.abs(item.recoveredMinor), item.newOverdueMinor]), 1);
  return <div className="flex h-40 items-center gap-1" role="img" aria-label="Fourteen day activity: green bars are money recovered and orange bars are new overdue.">
    {visible.map((item) => <div key={item.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5" title={`${item.date}: ${money(item.recoveredMinor, currency)} recovered; ${money(item.newOverdueMinor, currency)} new overdue`}>
      <div className="flex h-[68px] w-full items-end justify-center"><div className="w-[72%] rounded-t bg-emerald-600" style={{ height: `${Math.max(item.recoveredMinor ? 4 : 0, (Math.abs(item.recoveredMinor) / max) * 100)}%` }} /></div>
      <div className="h-px w-full bg-slate-300" />
      <div className="flex h-[68px] w-full items-start justify-center"><div className="w-[72%] rounded-b bg-orange-500" style={{ height: `${Math.max(item.newOverdueMinor ? 4 : 0, (item.newOverdueMinor / max) * 100)}%` }} /></div>
      <span className="text-[8px] text-slate-400">{item.date.slice(8)}</span>
    </div>)}
  </div>;
}
