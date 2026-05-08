import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/useAuth'

const API_URL = import.meta.env.VITE_API_URL

type TransactionType = 'income' | 'expense'

type Transaction = {
  transactionId: string
  type: TransactionType
  amount: number
  category: string
  date: string
  memo?: string
}

const CATEGORIES = ['食費', '日用品', '交通費', '娯楽', '給与', 'その他']

function today() {
  return new Date().toISOString().slice(0, 10)
}

function Spinner() {
  return (
    <div className="flex items-center justify-center h-48">
      <div
        className="w-10 h-10 rounded-full border-4 animate-spin"
        style={{ borderColor: '#D85A30', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

// ── 編集モーダル ────────────────────────────────────────────────────────────

type EditModalProps = {
  tx: Transaction
  idToken: string
  onClose: () => void
  onSaved: () => void
  onUnauthorized: () => void
}

function EditModal({ tx, idToken, onClose, onSaved, onUnauthorized }: EditModalProps) {
  const [type, setType] = useState<TransactionType>(tx.type)
  const [amount, setAmount] = useState(String(tx.amount))
  const [category, setCategory] = useState(tx.category)
  const [date, setDate] = useState(tx.date.slice(0, 10))
  const [memo, setMemo] = useState(tx.memo ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setError('金額を正しく入力してください')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/transactions/${tx.transactionId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, amount: Number(amount), category, date, memo }),
      })
      if (res.status === 401 || res.status === 403) { onUnauthorized(); return }
      if (!res.ok) throw new Error('更新に失敗しました')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(61,31,15,0.35)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
        style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
      >
        <h2 className="text-sm font-bold mb-5" style={{ color: '#3D1F0F' }}>収支を編集</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 種別 */}
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: '#7A4A30' }}>種別</label>
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid #E8C9B0' }}>
              {(['expense', 'income'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="flex-1 py-2.5 text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: type === t ? (t === 'income' ? '#EF9F27' : '#D85A30') : '#FDF6F0',
                    color: type === t ? '#fff' : '#9A6050',
                  }}
                >
                  {t === 'income' ? '収入' : '支出'}
                </button>
              ))}
            </div>
          </div>

          {/* 金額 */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>金額（円）</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
            />
          </div>

          {/* カテゴリ */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>カテゴリ</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none appearance-none"
              style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* 日付 */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>日付</label>
            <div className="overflow-hidden rounded-xl" style={{ border: '1.5px solid #E8C9B0' }}>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full px-4 py-3 text-sm outline-none"
                style={{ backgroundColor: '#FDF6F0', color: '#3D1F0F', border: 'none', display: 'block' }}
                onFocus={e => (e.currentTarget.parentElement!.style.borderColor = '#D85A30')}
                onBlur={e => (e.currentTarget.parentElement!.style.borderColor = '#E8C9B0')}
              />
            </div>
          </div>

          {/* メモ */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>メモ（任意）</label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="自由記入"
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
              onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
              onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
            />
          </div>

          {error && (
            <div className="text-xs rounded-xl px-4 py-3" style={{ backgroundColor: '#FEE8E0', color: '#C0392B' }}>
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition hover:opacity-80"
              style={{ backgroundColor: '#FDF6F0', color: '#9A6050', border: '1.5px solid #E8C9B0' }}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 shadow"
              style={{ backgroundColor: '#D85A30' }}
            >
              {isSubmitting ? '更新中...' : '更新する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────

export function TransactionsPage() {
  const { idToken, handleUnauthorized } = useAuth()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterMonth, setFilterMonth] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')

  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [date, setDate] = useState(today())
  const [memo, setMemo] = useState('')

  const fetchTransactions = useCallback(async () => {
    setIsLoading(true)
    setFetchError(null)
    try {
      const res = await fetch(`${API_URL}/transactions`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (res.status === 401 || res.status === 403) { handleUnauthorized(); return }
      if (!res.ok) throw new Error('一覧の取得に失敗しました')
      const data = await res.json()
      const sorted = [...(data.transactions as Transaction[])].sort(
        (a, b) => b.date.localeCompare(a.date)
      )
      setTransactions(sorted)
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '取得に失敗しました')
    } finally {
      setIsLoading(false)
    }
  }, [idToken])

  useEffect(() => {
    if (idToken) void fetchTransactions()
  }, [idToken, fetchTransactions])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setFormError('金額を正しく入力してください')
      return
    }
    setFormError(null)
    setSuccessMsg(null)
    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type, amount: Number(amount), category, date, memo: memo || null }),
      })
      if (res.status === 401 || res.status === 403) { handleUnauthorized(); return }
      if (!res.ok) throw new Error('登録に失敗しました')
      setAmount('')
      setDate(today())
      setMemo('')
      setSuccessMsg('登録しました')
      await fetchTransactions()
      setTimeout(() => setSuccessMsg(null), 3000)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setIsSubmitting(false)
    }
  }

  const availableMonths = Array.from(
    new Set(transactions.map(tx => tx.date.slice(0, 7)))
  ).sort((a, b) => b.localeCompare(a))

  const filteredTransactions = transactions.filter(tx => {
    if (filterMonth && !tx.date.startsWith(filterMonth)) return false
    if (filterCategory && tx.category !== filterCategory) return false
    return true
  })

  async function handleDelete(transactionId: string) {
    setDeletingId(transactionId)
    try {
      const res = await fetch(`${API_URL}/transactions/${transactionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (res.status === 401 || res.status === 403) { handleUnauthorized(); return }
      if (!res.ok) throw new Error('削除に失敗しました')
      await fetchTransactions()
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <>
      {editingTx && (
        <EditModal
          tx={editingTx}
          idToken={idToken ?? ''}
          onClose={() => setEditingTx(null)}
          onSaved={() => { setEditingTx(null); void fetchTransactions() }}
          onUnauthorized={handleUnauthorized}
        />
      )}

      <div className="px-4 py-6 md:px-8 md:py-8 max-w-5xl mx-auto">
        <h1 className="text-xl font-bold mb-6" style={{ color: '#3D1F0F' }}>収支管理</h1>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* 登録フォーム */}
          <div className="lg:w-72 flex-shrink-0">
            <div
              className="rounded-2xl p-4 md:p-6 shadow-sm overflow-hidden"
              style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
            >
              <h2 className="text-sm font-bold mb-5" style={{ color: '#3D1F0F' }}>収支を登録</h2>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 種別 */}
                <div>
                  <label className="block text-xs font-semibold mb-2" style={{ color: '#7A4A30' }}>
                    種別
                  </label>
                  <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid #E8C9B0' }}>
                    {(['expense', 'income'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className="flex-1 py-2.5 text-sm font-semibold transition-colors"
                        style={{
                          backgroundColor: type === t ? (t === 'income' ? '#EF9F27' : '#D85A30') : '#FDF6F0',
                          color: type === t ? '#fff' : '#9A6050',
                        }}
                      >
                        {t === 'income' ? '収入' : '支出'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 金額 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>
                    金額（円）
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                    placeholder="0"
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none transition"
                    style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
                  />
                </div>

                {/* カテゴリ */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>
                    カテゴリ
                  </label>
                  <select
                    value={category}
                    onChange={e => setCategory(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none transition appearance-none"
                    style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                {/* 日付 */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>
                    日付
                  </label>
                  <div className="overflow-hidden rounded-xl" style={{ border: '1.5px solid #E8C9B0' }}>
                    <input
                      type="date"
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      required
                      className="w-full px-4 py-3 text-sm outline-none transition"
                      style={{ backgroundColor: '#FDF6F0', color: '#3D1F0F', border: 'none', display: 'block' }}
                      onFocus={e => (e.currentTarget.parentElement!.style.borderColor = '#D85A30')}
                      onBlur={e => (e.currentTarget.parentElement!.style.borderColor = '#E8C9B0')}
                    />
                  </div>
                </div>

                {/* メモ */}
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: '#7A4A30' }}>
                    メモ（任意）
                  </label>
                  <input
                    type="text"
                    value={memo}
                    onChange={e => setMemo(e.target.value)}
                    placeholder="自由記入"
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none transition"
                    style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F' }}
                    onFocus={e => (e.currentTarget.style.borderColor = '#D85A30')}
                    onBlur={e => (e.currentTarget.style.borderColor = '#E8C9B0')}
                  />
                </div>

                {formError && (
                  <div className="text-xs rounded-xl px-4 py-3" style={{ backgroundColor: '#FEE8E0', color: '#C0392B' }}>
                    {formError}
                  </div>
                )}
                {successMsg && (
                  <div className="text-xs rounded-xl px-4 py-3" style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}>
                    {successMsg}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3 rounded-xl text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shadow"
                  style={{ backgroundColor: '#D85A30' }}
                >
                  {isSubmitting ? '登録中...' : '登録する'}
                </button>
              </form>
            </div>
          </div>

          {/* 一覧 */}
          <div className="flex-1 min-w-0">
            <div
              className="rounded-2xl shadow-sm overflow-hidden"
              style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
            >
              <div className="px-6 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: '1px solid #F0D8C8' }}>
                <h2 className="text-sm font-bold mr-auto" style={{ color: '#3D1F0F' }}>収支一覧</h2>
                <select
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs outline-none appearance-none"
                  style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F', minWidth: '110px' }}
                >
                  <option value="">すべての月</option>
                  {availableMonths.map(m => (
                    <option key={m} value={m}>{m.replace('-', '年')}月</option>
                  ))}
                </select>
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="px-3 py-1.5 rounded-xl text-xs outline-none appearance-none"
                  style={{ backgroundColor: '#FDF6F0', border: '1.5px solid #E8C9B0', color: '#3D1F0F', minWidth: '100px' }}
                >
                  <option value="">すべてのカテゴリ</option>
                  {CATEGORIES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {(filterMonth || filterCategory) && (
                  <button
                    onClick={() => { setFilterMonth(''); setFilterCategory('') }}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold transition hover:opacity-80"
                    style={{ backgroundColor: '#FEE8E0', color: '#C0392B', border: '1px solid #F5C0B0' }}
                  >
                    リセット
                  </button>
                )}
              </div>

              {isLoading ? (
                <Spinner />
              ) : fetchError ? (
                <div className="px-6 py-5 text-sm" style={{ color: '#C0392B' }}>{fetchError}</div>
              ) : transactions.length === 0 ? (
                <p className="px-6 py-12 text-sm text-center" style={{ color: '#C09080' }}>
                  まだ収支データがありません
                </p>
              ) : filteredTransactions.length === 0 ? (
                <p className="px-6 py-12 text-sm text-center" style={{ color: '#C09080' }}>
                  条件に一致する収支がありません
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ backgroundColor: '#FDF6F0' }}>
                        {['日付', 'カテゴリ', '種別', '金額', ''].map((h, i) => (
                          <th
                            key={i}
                            className="px-5 py-3 text-left text-xs font-semibold whitespace-nowrap"
                            style={{ color: '#9A6050' }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransactions.map((tx, i) => (
                        <tr
                          key={tx.transactionId}
                          style={{ borderTop: i === 0 ? 'none' : '1px solid #F5EAE0' }}
                        >
                          <td className="px-5 py-3.5 text-xs whitespace-nowrap" style={{ color: '#7A4A30' }}>
                            {tx.date.slice(0, 10)}
                          </td>
                          <td className="px-5 py-3.5 font-medium whitespace-nowrap" style={{ color: '#3D1F0F' }}>
                            <div>{tx.category}</div>
                            {tx.memo && (
                              <div className="text-xs mt-0.5 truncate max-w-[120px]" style={{ color: '#B08070' }}>
                                {tx.memo}
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5 whitespace-nowrap">
                            <span
                              className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                              style={{
                                backgroundColor: tx.type === 'income' ? '#FEF3DC' : '#FEE8E0',
                                color: tx.type === 'income' ? '#B07A00' : '#C0392B',
                              }}
                            >
                              {tx.type === 'income' ? '収入' : '支出'}
                            </span>
                          </td>
                          <td
                            className="px-5 py-3.5 font-bold text-right whitespace-nowrap"
                            style={{ color: tx.type === 'income' ? '#EF9F27' : '#D85A30' }}
                          >
                            {tx.type === 'expense' ? '−' : '+'}¥{tx.amount.toLocaleString('ja-JP')}
                          </td>
                          <td className="px-3 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => setEditingTx(tx)}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition hover:opacity-80"
                                style={{ backgroundColor: '#FDF6F0', color: '#7A4A30', border: '1px solid #E8C9B0' }}
                                title="編集"
                              >
                                編集
                              </button>
                              <button
                                onClick={() => {
                                  if (window.confirm('この収支を削除しますか？')) {
                                    void handleDelete(tx.transactionId)
                                  }
                                }}
                                disabled={deletingId === tx.transactionId}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition hover:opacity-80 disabled:opacity-50"
                                style={{ backgroundColor: '#FEE8E0', color: '#C0392B', border: '1px solid #F5C0B0' }}
                                title="削除"
                              >
                                {deletingId === tx.transactionId ? '...' : '削除'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
