import type { ReportMetrics } from "@/lib/reports/metrics";
import { formatCurrencyMinor } from "@/lib/financial/money";

function money(minor: number, currency: string) {
  return formatCurrencyMinor(minor, currency, { explicitCode: currency !== "MYR" });
}

export function AgingDonut({ metrics, compact = false }: { metrics: ReportMetrics; compact?: boolean }) {
  const currency = metrics.currencies[0] ?? "MYR";
  const total = metrics.agingDonut.reduce((sum, item) => sum + item.amountMinor, 0);
  let cursor = 0;
  const segments = metrics.agingDonut.map((item) => {
    const start = cursor;
    cursor += total ? (item.amountMinor / total) * 100 : 0;
    return `${item.color} ${start}% ${cursor}%`;
  });
  // Retained as a non-brand data visual: each segment has a text legend and accessible label.
  const background = total ? `conic-gradient(${segments.join(",")})` : "var(--cb-chart-grid)";
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={compact ? "mobile-aging-title" : "aging-title"}>
    <div className="flex items-center justify-between"><div><p id={compact ? "mobile-aging-title" : "aging-title"} className="text-sm font-bold text-[var(--cb-brand-navy)]">Aging</p><p className="text-[11px] text-slate-500">Outstanding by days past due</p></div><span className="text-xs font-bold text-slate-700">{money(total, currency)}</span></div>
    <div className={`mt-4 grid items-center gap-4 ${compact ? "grid-cols-[92px_1fr]" : "grid-cols-[130px_1fr]"}`}>
      <div className={`${compact ? "h-[92px] w-[92px]" : "h-[130px] w-[130px]"} relative rounded-full`} style={{ background }} role="img" aria-label={metrics.agingDonut.map((item) => `${item.label}: ${money(item.amountMinor, currency)}`).join(", ")}>
        <div className="absolute inset-[22%] flex items-center justify-center rounded-full bg-white text-center"><div><p className="text-[10px] text-slate-400">Cases</p><p className="text-lg font-black text-[var(--cb-brand-navy)]">{metrics.activeCases}</p></div></div>
      </div>
      <div className="space-y-2">{metrics.agingDonut.map((item) => <div key={item.label} className="flex items-center gap-2 text-[11px]"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} /><span className="flex-1 font-semibold text-slate-600">{item.label}</span><span className="font-bold text-slate-800">{money(item.amountMinor, currency)}</span><span className="w-5 text-right text-slate-400">{item.count}</span></div>)}</div>
    </div>
  </section>;
}
