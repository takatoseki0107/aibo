import { useCallback, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useAuth } from '../contexts/useAuth'

const API_URL = import.meta.env.VITE_API_URL

type Summary = {
  income: number
  expense: number
  balance: number
}

type Transaction = {
  transactionId: string
  type: 'income' | 'expense'
  amount: number
  category: string
  date: string
  description?: string
}

type MonthlyBar = {
  date: string
  収入: number
  支出: number
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div
        className="w-10 h-10 rounded-full border-4 border-t-transparent animate-spin"
        style={{ borderColor: '#D85A30', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

function SummaryCard({ label, amount, color }: { label: string; amount: number; color: string }) {
  const formatted = amount.toLocaleString('ja-JP')
  return (
    <div
      className="rounded-2xl p-6 shadow-sm flex flex-col gap-2"
      style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
    >
      <span className="text-xs font-semibold" style={{ color: '#9A6050' }}>{label}</span>
      <span className="text-2xl font-bold" style={{ color }}>
        ¥{formatted}
      </span>
    </div>
  )
}

function buildChartData(transactions: Transaction[]): MonthlyBar[] {
  const now = new Date()
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const monthly = transactions
    .filter(tx => tx.date.startsWith(currentMonth))
    .reduce<Record<string, { 収入: number; 支出: number }>>((acc, tx) => {
      const day = tx.date.slice(0, 10)
      if (!acc[day]) acc[day] = { 収入: 0, 支出: 0 }
      if (tx.type === 'income') acc[day].収入 += tx.amount
      else acc[day].支出 += tx.amount
      return acc
    }, {})

  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date: date.slice(5), ...values }))
}

export function DashboardPage() {
  const { idToken, handleUnauthorized } = useAuth()
  const [summary, setSummary] = useState<Summary | null>(null)
  const [chartData, setChartData] = useState<MonthlyBar[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const headers = { Authorization: `Bearer ${idToken}` }
      const [summaryRes, txRes] = await Promise.all([
        fetch(`${API_URL}/transactions/summary`, { headers }),
        fetch(`${API_URL}/transactions`, { headers }),
      ])

      if (summaryRes.status === 401 || summaryRes.status === 403) { handleUnauthorized(); return }
      if (txRes.status === 401 || txRes.status === 403) { handleUnauthorized(); return }
      if (!summaryRes.ok) throw new Error('サマリーの取得に失敗しました')
      if (!txRes.ok) throw new Error('取引データの取得に失敗しました')

      const summaryData: Summary = await summaryRes.json()
      const txData: { transactions: Transaction[] } = await txRes.json()

      setSummary(summaryData)
      setChartData(buildChartData(txData.transactions))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [idToken])

  useEffect(() => {
    if (!idToken) return
    void fetchData()
  }, [idToken, fetchData])

  return (
    <div className="px-8 py-8 max-w-4xl mx-auto">
      <h1 className="text-xl font-bold mb-6" style={{ color: '#3D1F0F' }}>ダッシュボード</h1>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <div
          className="rounded-xl px-5 py-4 text-sm"
          style={{ backgroundColor: '#FEE8E0', color: '#C0392B' }}
        >
          {error}
        </div>
      ) : (
        <>
          {/* サマリーカード */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <SummaryCard label="収入" amount={summary?.income ?? 0} color="#EF9F27" />
            <SummaryCard label="支出" amount={summary?.expense ?? 0} color="#D85A30" />
            <SummaryCard label="残高" amount={summary?.balance ?? 0} color="#3D1F0F" />
          </div>

          {/* 当月棒グラフ */}
          <div
            className="rounded-2xl p-6 shadow-sm"
            style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
          >
            <h2 className="text-sm font-semibold mb-4" style={{ color: '#7A4A30' }}>
              当月の収支（日別）
            </h2>
            {chartData.length === 0 ? (
              <p className="text-sm text-center py-10" style={{ color: '#C09080' }}>
                今月の取引データがありません
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0D8C8" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9A6050' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9A6050' }} tickFormatter={(value) => `¥${value.toLocaleString()}`} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #F0D8C8', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="収入" fill="#EF9F27" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="支出" fill="#D85A30" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  )
}
