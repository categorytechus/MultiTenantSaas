"use client";

import { useState, useEffect } from "react";
import Layout from "../../components/Layout";
import { ChevronDown, TrendingUp, Loader2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import { apiFetch } from "../../src/lib/api";

function StatCard({ label, value, footer, sub }: { label: string; value: string | number; footer: string; sub: string }) {
  return (
    <div className="bg-gradient-to-b from-[#f6f7f8] to-white border border-gray-200 rounded-xl p-6 flex flex-col shadow-sm">
      <div className="flex justify-between items-start mb-3">
        <span className="text-[13px] font-medium text-gray-500">{label}</span>
        <div className="flex items-center gap-1 text-xs font-semibold text-gray-800 bg-white border border-gray-200 rounded-md px-2 py-0.5">
          <TrendingUp size={13} className="text-gray-500" />
          {value}
        </div>
      </div>
      <div className="text-[36px] font-semibold text-gray-900 leading-none mb-6 tracking-tight">{value}</div>
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 mb-1">
        {footer} <TrendingUp size={13} />
      </div>
      <div className="text-[13px] text-gray-500">{sub}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<"Daily" | "Weekly" | "Monthly">("Daily");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [preset, setPreset] = useState("All");
  const [loading, setLoading] = useState(true);

  const [data, setData] = useState({
    chart_data: [],
    totals: {
      total_documents: 0,
      success_count: 0,
      error_count: 0,
      success_rate: "100.0%",
    }
  });

  useEffect(() => {
    let finalStart = startDate;
    let finalEnd = endDate;

    if (preset !== "Custom" && preset !== "All") {
      const now = new Date();
      finalEnd = now.toISOString();
      let start = new Date();

      switch (preset) {
        case "Last 1 hr": start.setHours(start.getHours() - 1); break;
        case "Last 4 hr": start.setHours(start.getHours() - 4); break;
        case "Last 1d": start.setDate(start.getDate() - 1); break;
        case "Last 14d": start.setDate(start.getDate() - 14); break;
        case "1 month": start.setMonth(start.getMonth() - 1); break;
        case "3 month": start.setMonth(start.getMonth() - 3); break;
        case "6 month": start.setMonth(start.getMonth() - 6); break;
        case "1 yr": start.setFullYear(start.getFullYear() - 1); break;
      }
      finalStart = start.toISOString();
    } else if (preset === "All") {
      finalStart = "";
      finalEnd = "";
    } else {
      if (startDate) finalStart = new Date(`${startDate}T00:00:00Z`).toISOString();
      if (endDate) finalEnd = new Date(`${endDate}T23:59:59.999Z`).toISOString();
    }

    const fetchStats = async () => {
      setLoading(true);
      try {
        let url = `/dashboard/stats?timeframe=${timeframe}`;
        if (finalStart) url += `&start_date=${encodeURIComponent(finalStart)}`;
        if (finalEnd) url += `&end_date=${encodeURIComponent(finalEnd)}`;
        
        const res = await apiFetch<any>(url);
        if (res.success) {
          setData(res.data.data);
        }
      } catch (err) {
        console.error("Failed to fetch dashboard stats", err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchStats();
  }, [startDate, endDate, preset, timeframe]);

  return (
    <Layout>
      <div className="p-8 max-sm:p-4 bg-white min-h-full">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 h-9 shadow-sm min-w-[148px]">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPreset("Custom");
              }}
              aria-label="Start date"
              className="border-none outline-none bg-transparent text-[13px] text-gray-900 w-full [color-scheme:light]"
            />
          </div>
          <span className="text-[13px] text-gray-500">to</span>
          <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 h-9 shadow-sm min-w-[148px]">
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPreset("Custom");
              }}
              aria-label="End date"
              className="border-none outline-none bg-transparent text-[13px] text-gray-900 w-full [color-scheme:light]"
            />
          </div>
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              if (e.target.value !== "Custom") {
                setStartDate("");
                setEndDate("");
              }
            }}
            className="bg-white border border-gray-200 rounded-lg px-3 h-9 text-[13px] text-gray-900 shadow-sm cursor-pointer min-w-[140px] outline-none"
          >
            <option value="All">All</option>
            <option value="Last 1 hr">Last 1 hr</option>
            <option value="Last 4 hr">Last 4 hr</option>
            <option value="Last 1d">Last 1d</option>
            <option value="Last 14d">Last 14d</option>
            <option value="1 month">1 month</option>
            <option value="3 month">3 month</option>
            <option value="6 month">6 month</option>
            <option value="1 yr">1 yr</option>
            <option value="Custom" disabled hidden>Custom</option>
          </select>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-6 max-lg:grid-cols-2 max-sm:grid-cols-1 relative">
          {loading && (
            <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center rounded-xl backdrop-blur-[1px]">
              <Loader2 className="animate-spin text-gray-400" size={24} />
            </div>
          )}
          <StatCard label="Total Documents Processed" value={data.totals.total_documents} footer="Total files processed" sub="Total Documents Processed" />
          <StatCard label="Success Count" value={data.totals.success_count} footer="High success rate" sub="Success Count" />
          <StatCard label="Error Count" value={data.totals.error_count} footer="Low error rate" sub="Error Count" />
          <StatCard label="Success Rate" value={data.totals.success_rate} footer="Strong performance" sub="Success Rate" />
        </div>

        {/* Chart controls */}
        <div className="flex justify-end gap-2 mb-4">
          {(["Daily", "Weekly", "Monthly"] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-4 py-1.5 text-[13px] font-medium rounded-lg cursor-pointer font-sans transition-all ${
                timeframe === tf
                  ? "bg-[#111827] text-white border border-[#111827]"
                  : "bg-white text-[#111827] border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm relative">
          {loading && (
            <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center rounded-xl backdrop-blur-[1px]">
              <Loader2 className="animate-spin text-gray-400" size={24} />
            </div>
          )}
          <div className="mb-8">
            <div className="text-base font-semibold text-gray-900 mb-1">Documents Processed ({timeframe})</div>
            <div className="text-[13px] text-gray-500">Documents processed over the selected date range</div>
          </div>
          <div style={{ height: 320, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart_data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#9ca3af" }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#9ca3af" }} label={{ value: "Number of Occurrences", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "#9ca3af", fontSize: 12 } }} />
                <Tooltip cursor={{ fill: "#f3f4f6" }} contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, marginTop: 10 }} />
                <Bar dataKey="total_documents" name="Total" stackId="a" fill="#4f46e5" radius={[0, 0, 4, 4]} barSize={32} />
                <Bar dataKey="success_count" name="Success" stackId="a" fill="#2dd4bf" radius={[0, 0, 0, 0]} barSize={32} />
                <Bar dataKey="error_count" name="Error" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}
