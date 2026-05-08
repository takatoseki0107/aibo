import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/useAuth'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'ダッシュボード', icon: '📊' },
  { to: '/transactions', label: '収支管理', icon: '📒' },
  { to: '/advice', label: 'AIアドバイス', icon: '🤖' },
]

export function Layout() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-screen">
      {/* サイドバー（PC: md以上のみ表示） */}
      <aside
        className="w-56 flex-col flex-shrink-0 hidden md:flex"
        style={{ backgroundColor: '#3D1F0F' }}
      >
        {/* ロゴ */}
        <div className="px-6 py-6">
          <span
            className="text-2xl font-black tracking-tight"
            style={{ color: '#EF9F27' }}
          >
            Aibo
          </span>
        </div>

        {/* ナビ */}
        <nav className="flex-1 px-3 space-y-1">
          {NAV_ITEMS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'text-white' : 'text-orange-200 hover:text-white hover:bg-white/10'
                }`
              }
              style={({ isActive }) =>
                isActive ? { backgroundColor: '#D85A30' } : undefined
              }
            >
              <span>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* ログアウト */}
        <div className="px-3 py-5">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-orange-200 hover:text-white hover:bg-white/10 transition-colors"
          >
            <span>🚪</span>
            ログアウト
          </button>
        </div>
      </aside>

      {/* メインエリア */}
      <main
        className="flex-1 overflow-auto pb-16 md:pb-0"
        style={{ backgroundColor: '#FDF6F0' }}
      >
        <Outlet />
      </main>

      {/* ボトムナビ（スマホ: md未満のみ表示） */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 flex items-center border-t z-50"
        style={{ backgroundColor: '#3D1F0F', borderColor: '#5C3317' }}
      >
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium transition-colors ${
                isActive ? 'text-white' : 'text-orange-200'
              }`
            }
            style={({ isActive }) =>
              isActive ? { color: '#EF9F27' } : undefined
            }
          >
            <span className="text-xl">{icon}</span>
            {label}
          </NavLink>
        ))}
        <button
          onClick={handleSignOut}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-xs font-medium text-orange-200 transition-colors"
        >
          <span className="text-xl">🚪</span>
          ログアウト
        </button>
      </nav>
    </div>
  )
}
