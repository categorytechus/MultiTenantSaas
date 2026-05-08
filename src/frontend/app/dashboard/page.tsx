"use client";

import { useState } from "react";
import Layout from "../../components/Layout";
import { ChevronDown, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";

const chartData = [
  { name: "Mar 4",  total_documents: 2,  success_count: 2,  error_count: 0 },
  { name: "Jul 17", total_documents: 22, success_count: 12, error_count: 0 },
  { name: "Jul 20", total_documents: 18, success_count: 10, error_count: 0 },
  { name: "Jul 24", total_documents: 50, success_count: 25, error_count: 0 },
  { name: "Jul 29", total_documents: 62, success_count: 31, error_count: 0 },
  { name: "Jul 31", total_documents: 10, success_count: 5,  error_count: 0 },
  { name: "Aug 2",  total_documents: 50, success_count: 25, error_count: 0 },
  { name: "Aug 4",  total_documents: 16, success_count: 8,  error_count: 0 },
  { name: "Aug 6",  total_documents: 18, success_count: 9,  error_count: 0 },
  { name: "Aug 8",  total_documents: 28, success_count: 14, error_count: 0 },
  { name: "Aug 10", total_documents: 14, success_count: 7,  error_count: 0 },
  { name: "Aug 12", total_documents: 48, success_count: 24, error_count: 0 },
  { name: "Aug 14", total_documents: 4,  success_count: 2,  error_count: 0 },
  { name: "Aug 16", total_documents: 68, success_count: 34, error_count: 0 },
  { name: "Aug 18", total_documents: 8,  success_count: 4,  error_count: 0 },
  { name: "Aug 20", total_documents: 24, success_count: 12, error_count: 0 },
  { name: "Aug 22", total_documents: 62, success_count: 31, error_count: 0 },
];

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

  return (
    <Layout>
      <div className="p-8 max-sm:p-4 bg-white min-h-full">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg px-3 h-9 shadow-sm min-w-[148px]">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
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
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
              className="border-none outline-none bg-transparent text-[13px] text-gray-900 w-full [color-scheme:light]"
            />
          </div>
          <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-3 h-9 text-[13px] text-gray-900 shadow-sm cursor-pointer min-w-[140px] gap-2">
            <span>All</span>
            <ChevronDown size={14} className="text-gray-400" />
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-4 gap-4 mb-6 max-lg:grid-cols-2 max-sm:grid-cols-1">
          <StatCard label="Total Documents Processed" value={257} footer="Total files processed" sub="Total Documents Processed" />
          <StatCard label="Success Count" value={257} footer="High success rate" sub="Success Count" />
          <StatCard label="Error Count" value={0} footer="Low error rate" sub="Error Count" />
          <StatCard label="Success Rate" value="100.0%" footer="Strong performance" sub="Success Rate" />
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
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="mb-8">
            <div className="text-base font-semibold text-gray-900 mb-1">Documents Processed by Day</div>
            <div className="text-[13px] text-gray-500">Documents processed per day over the selected date range</div>
          </div>
          <div style={{ height: 320, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#9ca3af" }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#9ca3af" }} label={{ value: "Number of Occurrences", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fill: "#9ca3af", fontSize: 12 } }} />
                <Tooltip cursor={{ fill: "#f3f4f6" }} contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12, marginTop: 10 }} />
                <Bar dataKey="total_documents" name="total_documents" stackId="a" fill="#4f46e5" radius={[0, 0, 4, 4]} barSize={32} />
                <Bar dataKey="success_count" name="success_count" stackId="a" fill="#2dd4bf" radius={[0, 0, 0, 0]} barSize={32} />
                <Bar dataKey="error_count" name="error_count" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}
