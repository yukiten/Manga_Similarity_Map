import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  const isDark = (localStorage.getItem('manga-map-theme') || 'light') === 'dark'

  const bg      = isDark ? '#0d1117' : '#f5f4f0'
  const text    = isDark ? '#e2e8f0' : '#0f172a'
  const textSub = isDark ? '#6b7280' : '#9ca3af'
  const accent  = isDark ? '#818cf8' : '#4f46e5'

  return (
    <div style={{
      minHeight: '100vh', background: bg, color: text,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 32, textAlign: 'center',
    }}>
      <div style={{ fontSize: 80, fontWeight: 900, lineHeight: 1, color: accent, opacity: 0.15 }}>404</div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '16px 0 8px' }}>
        ページが見つかりません
      </h1>
      <p style={{ fontSize: 14, color: textSub, lineHeight: 1.7, maxWidth: 360, margin: '0 0 28px' }}>
        お探しのページは存在しないか、移動または削除された可能性があります。
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link to="/manga/map" style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 20px', borderRadius: 10,
          background: accent, color: '#fff',
          textDecoration: 'none', fontSize: 14, fontWeight: 700,
        }}>
          2D マップへ
        </Link>
        <Link to="/" style={{
          padding: '10px 20px', borderRadius: 10,
          border: `1px solid ${isDark ? '#1e2535' : '#d6dbe8'}`,
          background: 'transparent', color: textSub,
          textDecoration: 'none', fontSize: 14, fontWeight: 600,
        }}>
          トップページへ
        </Link>
      </div>
    </div>
  )
}
