import React, { useState, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { FileText, CheckCircle2, XCircle, TrendingUp } from 'lucide-react'
import { useDocuments } from '../hooks/useDocuments'
import { Document, ChartDataPoint } from '../types'
import { Spinner } from '../components/ui/Spinner'

type Timeframe = 'daily' | 'weekly' | 'monthly'

function computeChartData(docs: Document[], timeframe: Timeframe): ChartDataPoint[] {
  const now = new Date()
  const buckets: Record<string, number> = {}

  const rangeCount = timeframe === 'daily' ? 14 : timeframe === 'weekly' ? 12 : 6

  for (let i = rangeCount - 1; i >= 0; i--) {
    const d = new Date(now)
    if (timeframe === 'daily') d.setDate(d.getDate() - i)
    else if (timeframe === 'weekly') d.setDate(d.getDate() - i * 7)
    else d.setMonth(d.getMonth() - i)

    let key: string
    if (timeframe === 'daily') key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    else if (timeframe === 'weekly') key = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleDateString('en-US', { month: 'short' })}`
    else key = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })

    buckets[key] = 0
  }

  docs.forEach((doc) => {
    const date = new Date(doc.created_at)
    let key: string
    if (timeframe === 'daily') key = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    else if (timeframe === 'weekly') key = `W${Math.ceil(date.getDate() / 7)} ${date.toLocaleDateString('en-US', { month: 'short' })}`
    else key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })

    if (key in buckets) buckets[key]++
  })

  return Object.entries(buckets).map(([date, count]) => ({ date, count }))
}

function StatCard({
  title,
  value,
  icon,
  iconColor,
  iconBg,
  sub,
}: {
  title: string
  value: string | number
  icon: React.ReactNode
  iconColor: string
  iconBg: string
  sub?: string
}) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        border: '1px solid #ebebeb',
        borderRadius: 10,
        padding: '20px 22px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 12, color: '#888', marginBottom: 6, fontWeight: 500, letterSpacing: '0.2px' }}>
            {title}
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.5px' }}>
            {value}
          </p>
          {sub && <p style={{ fontSize: 11.5, color: '#aaa', marginTop: 4 }}>{sub}</p>}
        </div>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            backgroundColor: iconBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: iconColor,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe>('daily')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const { data, isLoading, error } = useDocuments({
    size: 500, // Get all for stats
    from: fromDate || undefined,
    to: toDate || undefined,
  })

  const docs = data?.items ?? []

  const stats = useMemo(() => {
    const total = docs.length
    const success = docs.filter((d) => d.status === 'ready').length
    const err = docs.filter((d) => d.status === 'failed').length
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0
    return { total, success, error: err, successRate }
  }, [docs])

  const chartData = useMemo(() => computeChartData(docs, timeframe), [docs, timeframe])

  return (
    <div style={{ padding: '28px 32px', maxWidth: 1200, fontFamily: "'DM Sans', sans-serif" }}>
      {/* Page heading */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
          Overview of your knowledge base and document processing activity.
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24, flexWrap: 'wrap' }}>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          style={{
            padding: '7px 10px',
            border: '1px solid #e5e5e5',
            borderRadius: 7,
            fontSize: 12.5,
            color: '#555',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
          placeholder="From"
        />
        <span style={{ fontSize: 12, color: '#bbb' }}>to</span>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          style={{
            padding: '7px 10px',
            border: '1px solid #e5e5e5',
            borderRadius: 7,
            fontSize: 12.5,
            color: '#555',
            outline: 'none',
            fontFamily: "'DM Sans', sans-serif",
          }}
        />
        {(fromDate || toDate) && (
          <button
            onClick={() => { setFromDate(''); setToDate('') }}
            style={{
              fontSize: 12,
              color: '#888',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 6,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Stats cards */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div style={{ color: '#e53e3e', fontSize: 13, padding: 16, backgroundColor: '#fff5f5', borderRadius: 8, border: '1px solid #fed7d7' }}>
          Failed to load statistics.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 16,
              marginBottom: 28,
            }}
          >
            <StatCard
              title="Total Documents"
              value={stats.total}
              icon={<FileText size={16} />}
              iconColor="#555"
              iconBg="#f5f5f5"
            />
            <StatCard
              title="Processed Successfully"
              value={stats.success}
              icon={<CheckCircle2 size={16} />}
              iconColor="#16a34a"
              iconBg="#f0fdf4"
              sub="Status: ready"
            />
            <StatCard
              title="Failed"
              value={stats.error}
              icon={<XCircle size={16} />}
              iconColor="#dc2626"
              iconBg="#fff5f5"
              sub="Status: failed"
            />
            <StatCard
              title="Success Rate"
              value={`${stats.successRate}%`}
              icon={<TrendingUp size={16} />}
              iconColor="#7c3aed"
              iconBg="#f5f3ff"
            />
          </div>

          {/* Chart */}
          <div
            style={{
              backgroundColor: 'white',
              border: '1px solid #ebebeb',
              borderRadius: 10,
              padding: '20px 22px',
              boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 20,
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                  Document uploads
                </h2>
                <p style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                  Documents uploaded over time
                </p>
              </div>
              {/* Timeframe toggles */}
              <div
                style={{
                  display: 'flex',
                  gap: 2,
                  backgroundColor: '#f5f5f5',
                  borderRadius: 7,
                  padding: 3,
                }}
              >
                {(['daily', 'weekly', 'monthly'] as Timeframe[]).map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setTimeframe(tf)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 5,
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: timeframe === tf ? 500 : 400,
                      backgroundColor: timeframe === tf ? 'white' : 'transparent',
                      color: timeframe === tf ? '#1a1a1a' : '#888',
                      boxShadow: timeframe === tf ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                      transition: 'all 0.12s ease',
                      fontFamily: "'DM Sans', sans-serif",
                      textTransform: 'capitalize',
                    }}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#aaa' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#aaa' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    border: '1px solid #ebebeb',
                    borderRadius: 7,
                    fontSize: 12,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    fontFamily: "'DM Sans', sans-serif",
                  }}
                  cursor={{ fill: '#f5f5f5' }}
                />
                <Bar dataKey="count" fill="#1a1a1a" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  )
}
