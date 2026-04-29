"use client";

import { useState } from "react";
import Layout from "../../components/Layout";
import "./dashboard.css";
import { ChevronDown, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const chartData = [
  { name: "Mar 4", total_documents: 2, success_count: 2, error_count: 0 },
  { name: "Jul 17", total_documents: 22, success_count: 12, error_count: 0 },
  { name: "Jul 20", total_documents: 18, success_count: 10, error_count: 0 },
  { name: "Jul 24", total_documents: 50, success_count: 25, error_count: 0 },
  { name: "Jul 29", total_documents: 62, success_count: 31, error_count: 0 },
  { name: "Jul 31", total_documents: 10, success_count: 5, error_count: 0 },
  { name: "Aug 2", total_documents: 50, success_count: 25, error_count: 0 },
  { name: "Aug 4", total_documents: 16, success_count: 8, error_count: 0 },
  { name: "Aug 6", total_documents: 18, success_count: 9, error_count: 0 },
  { name: "Aug 8", total_documents: 28, success_count: 14, error_count: 0 },
  { name: "Aug 10", total_documents: 14, success_count: 7, error_count: 0 },
  { name: "Aug 12", total_documents: 48, success_count: 24, error_count: 0 },
  { name: "Aug 14", total_documents: 4, success_count: 2, error_count: 0 },
  { name: "Aug 16", total_documents: 68, success_count: 34, error_count: 0 },
  { name: "Aug 18", total_documents: 8, success_count: 4, error_count: 0 },
  { name: "Aug 20", total_documents: 24, success_count: 12, error_count: 0 },
  { name: "Aug 22", total_documents: 62, success_count: 31, error_count: 0 },
];

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<"Daily" | "Weekly" | "Monthly">(
    "Daily"
  );
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  return (
    <Layout>
      <div className="content">
        <div className="filters-row">
          <div className="filter-input-wrap">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              aria-label="Start date"
            />
          </div>
          <span className="filter-text">to</span>
          <div className="filter-input-wrap">
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="End date"
            />
          </div>

          <div className="filter-dropdown">
            <span>All</span>
            <ChevronDown size={14} className="text-gray-400" />
          </div>
        </div>

        <div className="stats">
          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-lbl">Total Documents Processed</span>
              <div className="stat-badge">
                <TrendingUp />
                257
              </div>
            </div>
            <div className="stat-val">257</div>
            <div className="stat-footer">
              Total files processed <TrendingUp />
            </div>
            <div className="stat-footer-sub">Total Documents Processed</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-lbl">Success Count</span>
              <div className="stat-badge">
                <TrendingUp />
                257
              </div>
            </div>
            <div className="stat-val">257</div>
            <div className="stat-footer">
              High success rate <TrendingUp />
            </div>
            <div className="stat-footer-sub">Success Count</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-lbl">Error Count</span>
              <div className="stat-badge">
                <TrendingUp />
                0
              </div>
            </div>
            <div className="stat-val">0</div>
            <div className="stat-footer">
              Low error rate <TrendingUp />
            </div>
            <div className="stat-footer-sub">Error Count</div>
          </div>

          <div className="stat-card">
            <div className="stat-header">
              <span className="stat-lbl">Success Rate</span>
              <div className="stat-badge">
                <TrendingUp />
                100.0%
              </div>
            </div>
            <div className="stat-val">100.0%</div>
            <div className="stat-footer">
              Strong performance <TrendingUp />
            </div>
            <div className="stat-footer-sub">Success Rate</div>
          </div>
        </div>

        <div className="chart-controls">
          <button
            className={`chart-toggle-btn ${
              timeframe === "Daily" ? "active" : ""
            }`}
            onClick={() => setTimeframe("Daily")}
          >
            Daily
          </button>
          <button
            className={`chart-toggle-btn ${
              timeframe === "Weekly" ? "active" : ""
            }`}
            onClick={() => setTimeframe("Weekly")}
          >
            Weekly
          </button>
          <button
            className={`chart-toggle-btn ${
              timeframe === "Monthly" ? "active" : ""
            }`}
            onClick={() => setTimeframe("Monthly")}
          >
            Monthly
          </button>
        </div>

        <div className="chart-section">
          <div className="chart-header">
            <div className="chart-title">Documents Processed by Day</div>
            <div className="chart-subtitle">
              Documents processed per day over the selected date range
            </div>
          </div>

          <div style={{ height: 320, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 20, right: 30, left: 0, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: "#9ca3af" }}
                  label={{
                    value: "Number of Occurrences",
                    angle: -90,
                    position: "insideLeft",
                    style: { textAnchor: "middle", fill: "#9ca3af", fontSize: 12 },
                  }}
                />
                <Tooltip
                  cursor={{ fill: "#f3f4f6" }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb" }}
                />
                <Legend
                  iconType="square"
                  wrapperStyle={{ fontSize: 12, marginTop: 10 }}
                />
                <Bar
                  dataKey="total_documents"
                  name="total_documents"
                  stackId="a"
                  fill="#4f46e5"
                  radius={[0, 0, 4, 4]}
                  barSize={32}
                />
                <Bar
                  dataKey="success_count"
                  name="success_count"
                  stackId="a"
                  fill="#2dd4bf"
                  radius={[0, 0, 0, 0]}
                  barSize={32}
                />
                <Bar
                  dataKey="error_count"
                  name="error_count"
                  stackId="a"
                  fill="#f87171"
                  radius={[4, 4, 0, 0]}
                  barSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Layout>
  );
}