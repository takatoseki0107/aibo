import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/useAuth'

const API_URL = import.meta.env.VITE_API_URL

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <div
        className="w-10 h-10 rounded-full border-4 animate-spin"
        style={{ borderColor: '#D85A30', borderTopColor: 'transparent' }}
      />
      <p className="text-sm" style={{ color: '#B07050' }}>AIがアドバイスを生成中...</p>
    </div>
  )
}

export function AdvicePage() {
  const { idToken, handleUnauthorized } = useAuth()
  const [advice, setAdvice] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAdvice = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/transactions/advice`, {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (res.status === 401 || res.status === 403) { handleUnauthorized(); return }
      if (!res.ok) throw new Error('アドバイスの取得に失敗しました')
      const data = await res.json()
      setAdvice(data.advice)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setIsLoading(false)
    }
  }, [idToken])

  useEffect(() => {
    if (idToken) void fetchAdvice()
  }, [idToken, fetchAdvice])

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold" style={{ color: '#3D1F0F' }}>AIアドバイス</h1>
        {!isLoading && (
          <button
            onClick={fetchAdvice}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 shadow"
            style={{ backgroundColor: '#D85A30' }}
          >
            アドバイスを更新
          </button>
        )}
      </div>

      {/* 説明バッジ */}
      <div
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium mb-6"
        style={{ backgroundColor: '#FDEEE6', color: '#D85A30' }}
      >
        <span>🤖</span>
        直近3ヶ月の収支データをもとにAIが分析します
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <div
          className="rounded-2xl p-8 text-center shadow-sm"
          style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
        >
          <p className="text-sm mb-4" style={{ color: '#C0392B' }}>{error}</p>
          <button
            onClick={fetchAdvice}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 shadow"
            style={{ backgroundColor: '#D85A30' }}
          >
            再試行する
          </button>
        </div>
      ) : (
        <div
          className="rounded-2xl shadow-sm overflow-hidden"
          style={{ backgroundColor: '#fff', border: '1px solid #F0D8C8' }}
        >
          {/* カードヘッダー */}
          <div
            className="px-6 py-4 flex items-center gap-3"
            style={{ borderBottom: '1px solid #F0D8C8', backgroundColor: '#FDF6F0' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: '#D85A30' }}
            >
              A
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#3D1F0F' }}>Aibo からのアドバイス</p>
              <p className="text-xs" style={{ color: '#B07050' }}>AI（Claude）が生成しました</p>
            </div>
          </div>

          {/* アドバイス本文 */}
          <div className="px-6 py-6">
            <p
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: '#3D1F0F' }}
            >
              {advice}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
