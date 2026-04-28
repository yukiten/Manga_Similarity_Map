import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { getTagColor } from './utils'
import { getCoverUrl } from './lib/imageSource'

const RANKING_COUNT = 30

function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

export default function MangaPortalPage() {
  const navigate  = useNavigate()
  const isMobile  = useIsMobile()
  const [mangaData, setMangaData]     = useState([])
  const [rankings,  setRankings]      = useState([])
  const [sales,     setSales]         = useState([])
  const [loading,   setLoading]       = useState(true)
  const [query,     setQuery]         = useState('')
  const [results,   setResults]       = useState([])
  const [dropOpen,  setDropOpen]      = useState(false)
  const searchRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    document.title = 'マンガ — ランキング・セール | Media Map'
    Promise.all([
      fetch('/manga_map.json').then(r => r.json()),
      fetch('/sales.json').then(r => r.json()).catch(() => []),
    ]).then(([manga, salesData]) => {
      const top = [...manga]
        .filter(m => m.score > 0 && m.popularity >= 2)
        .sort((a, b) => b.score - a.score)
        .slice(0, RANKING_COUNT)
      setMangaData(manga)
      setRankings(top)
      setSales(salesData)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!query.trim() || !mangaData.length) { setResults([]); setDropOpen(false); return }
    const q = query.toLowerCase()
    const r = mangaData
      .filter(m =>
        m.title.toLowerCase().includes(q) ||
        (m.title_ja && m.title_ja.includes(query)) ||
        (m.title_romaji && m.title_romaji.toLowerCase().includes(q))
      ).slice(0, 8)
    setResults(r)
    setDropOpen(r.length > 0)
  }, [query, mangaData])

  useEffect(() => {
    const h = e => { if (searchRef.current && !searchRef.current.contains(e.target)) setDropOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function pick(manga) { setDropOpen(false); setQuery(''); navigate(`/manga/map?id=${manga.id}`) }
  function onSubmit(e) { e.preventDefault(); if (results[0]) pick(results[0]) }

  return (
    <div style={{ minHeight: '100dvh', background: '#f5f4f0', color: '#1a1820', fontFamily: "system-ui, 'Segoe UI', sans-serif" }}>

      {/* ── 最上部アクセントライン ────────────────────────────────────── */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #c43030 0%, #e05040 50%, #c43030 100%)' }} />

      {/* ── ヘッダー ─────────────────────────────────────────────────── */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        height: 50,
        padding: '0 20px',
        background: 'rgba(250,249,245,0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: '1px solid #e8e6df',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <Link to="/" style={{ fontSize: 12, color: '#aaa8a0', textDecoration: 'none', transition: 'color 0.12s', flexShrink: 0, letterSpacing: '0.02em' }}
          onMouseEnter={e => e.currentTarget.style.color = '#5a5868'}
          onMouseLeave={e => e.currentTarget.style.color = '#aaa8a0'}
        >← Media Map</Link>

        <div style={{ width: 1, height: 16, background: '#e0ddd8' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#1a1820', letterSpacing: '-0.02em' }}>マンガ</span>
          {!loading && (
            <span style={{ fontSize: 10, color: '#aaa8a0', fontFamily: "'Courier New', monospace", letterSpacing: '0.04em' }}>
              {mangaData.length.toLocaleString()} works
            </span>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => navigate('/manga/map')}
          style={{
            padding: '7px 18px', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
            background: '#c43030', border: 'none',
            color: '#fff', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.02em',
            transition: 'background 0.12s, transform 0.1s',
            boxShadow: '0 2px 8px rgba(196,48,48,0.3)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#a82828'; e.currentTarget.style.transform = 'translateY(-1px)' }}
          onMouseLeave={e => { e.currentTarget.style.background = '#c43030'; e.currentTarget.style.transform = 'translateY(0)' }}
        >
          類似マップを開く →
        </button>
      </header>

      {/* ── 検索ヒーロー ─────────────────────────────────────────────── */}
      <div style={{
        background: '#fff',
        borderBottom: '1px solid #e8e6df',
        padding: isMobile ? '24px 16px' : '32px 32px',
      }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontFamily: "'Courier New', monospace", color: '#c43030', letterSpacing: '0.15em', marginBottom: 6 }}>// SEARCH DATABASE</div>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: '#1a1820', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              作品を探す
            </div>
          </div>

          <div ref={searchRef} style={{ position: 'relative', maxWidth: 600 }}>
            <form onSubmit={onSubmit}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#c0bdb8', fontSize: 16, pointerEvents: 'none' }}>🔍</span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="タイトル・よみがなで検索…"
                  style={{
                    width: '100%', padding: '13px 42px 13px 44px',
                    background: '#f5f4f0', border: '2px solid #e8e6df',
                    borderRadius: 8, color: '#1a1820', fontSize: 15,
                    outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
                    fontWeight: 500,
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = '#c43030'
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(196,48,48,0.1)'
                    if (results.length > 0) setDropOpen(true)
                  }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#e8e6df'; e.currentTarget.style.boxShadow = 'none' }}
                />
                {query && (
                  <button type="button" onClick={() => { setQuery(''); setDropOpen(false) }}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#aaa8a0', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 4 }}
                  >✕</button>
                )}
              </div>
            </form>

            {dropOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 50,
                background: '#fff', border: '1px solid #e8e6df', borderRadius: 8,
                overflow: 'hidden', boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
              }}>
                {results.map((m, i) => {
                  const cover = getCoverUrl(m)
                  return (
                    <div key={m.id} onClick={() => pick(m)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderBottom: i < results.length - 1 ? '1px solid #f0ede8' : 'none', transition: 'background 0.1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#faf8f5'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      {cover
                        ? <img src={cover} alt="" style={{ width: 32, height: 46, objectFit: 'cover', objectPosition: 'center top', borderRadius: 3, flexShrink: 0, border: '1px solid #e8e6df' }} onError={e => e.currentTarget.style.display = 'none'} />
                        : <div style={{ width: 32, height: 46, borderRadius: 3, background: '#f0ede8', flexShrink: 0 }} />
                      }
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1820', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title_ja || m.title}</div>
                        <div style={{ fontSize: 11, color: '#aaa8a0', marginTop: 2 }}>{m.year && `${m.year}年 · `}{m.tags?.[0]?.name || m.genre || ''}</div>
                      </div>
                      {m.score > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#9a6a00', flexShrink: 0 }}>★ {(m.score / 10).toFixed(1)}</span>}
                    </div>
                  )
                })}
                <div onClick={() => navigate('/manga/map')}
                  style={{ padding: '10px 14px', fontSize: 12, color: '#8a8880', cursor: 'pointer', borderTop: '1px solid #f0ede8', transition: 'background 0.1s', fontWeight: 600 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#faf8f5'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >◈ 3Dマップで全 {mangaData.length.toLocaleString()} 作品を探索する</div>
              </div>
            )}
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: isMobile ? '24px 14px 80px' : '36px 32px 100px' }}>

        {/* ── セール情報 ─────────────────────────────────────────────── */}
        {sales.length > 0 && (
          <section style={{ marginBottom: 48 }}>
            <SectionLabel index="01">セール・特典情報</SectionLabel>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
            }}>
              {sales.map(p => <SalePlatformCard key={p.platform} platform={p} />)}
            </div>
          </section>
        )}

        {/* ── ランキング ─────────────────────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 }}>
            <SectionLabel index="02" noMargin>スコアランキング TOP {RANKING_COUNT}</SectionLabel>
            <button onClick={() => navigate('/manga/map')}
              style={{ fontSize: 11, color: '#aaa8a0', background: 'none', border: '1px solid #e8e6df', borderRadius: 5, cursor: 'pointer', padding: '5px 12px', fontWeight: 600, transition: 'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f5f4f0'; e.currentTarget.style.color = '#5a5868' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = '#aaa8a0' }}
            >3Dマップで探索 ◈</button>
          </div>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '48px 0', color: '#aaa8a0', fontSize: 13 }}>
              <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid #e8e6df', borderTopColor: '#c43030', borderRadius: '50%', animation: 'spinArc 0.7s linear infinite' }} />
              読み込み中…
            </div>
          ) : (<>
            {/* TOP 3 大カード */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(3, 140px)' : 'repeat(3, 1fr)',
              gap: isMobile ? 10 : 16,
              marginBottom: 24,
              overflowX: isMobile ? 'auto' : 'visible',
              paddingBottom: isMobile ? 4 : 0,
            }}>
              {rankings.slice(0, 3).map((manga, i) => (
                <TopCard key={manga.id} manga={manga} rank={i + 1}
                  onClick={() => navigate(`/manga/map?id=${manga.id}`)} />
              ))}
            </div>

            {/* 4位〜30位 リスト */}
            <div style={{ background: '#fff', border: '1px solid #e8e6df', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '44px 60px 1fr 64px' : '52px 72px 1fr 88px 64px 52px',
                padding: '8px 16px',
                background: '#faf8f5',
                borderBottom: '1px solid #e8e6df',
                fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#aaa8a0',
                fontFamily: "'Courier New', monospace",
              }}>
                <div>RANK</div>
                <div></div>
                <div>TITLE</div>
                <div style={{ textAlign: 'right' }}>SCORE</div>
                {!isMobile && <div style={{ textAlign: 'right' }}>YEAR</div>}
                {!isMobile && <div></div>}
              </div>

              {rankings.slice(3).map((manga, i) => (
                <RankingRow key={manga.id} manga={manga} rank={i + 4} isMobile={isMobile}
                  animDelay={i * 0.025}
                  onClick={() => navigate(`/manga/map?id=${manga.id}`)} />
              ))}
            </div>
          </>)}
        </section>

      </main>
    </div>
  )
}

/* ── セクションラベル ────────────────────────────────────────────────────────── */
function SectionLabel({ children, noMargin, index }) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 16, display: 'flex', alignItems: 'center', gap: 12 }}>
      {index && (
        <span style={{ fontSize: 10, fontFamily: "'Courier New', monospace", color: '#c43030', letterSpacing: '0.1em', opacity: 0.7 }}>{index}</span>
      )}
      <div style={{ width: 3, height: 16, background: '#c43030', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 14, fontWeight: 800, color: '#1a1820', letterSpacing: '-0.01em' }}>{children}</span>
    </div>
  )
}

/* ── TOP 3 大カード ─────────────────────────────────────────────────────────── */
function TopCard({ manga, rank, onClick }) {
  const cover    = getCoverUrl(manga)
  const tagColor = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const rankLabel = ['金', '銀', '銅'][rank - 1]
  const rankBg    = rank === 1 ? '#c43030' : rank === 2 ? '#7a7a8a' : '#8a5020'

  return (
    <div
      onClick={onClick}
      style={{
        borderRadius: 10,
        overflow: 'hidden',
        border: `2px solid ${rank === 1 ? '#f0c0c0' : '#e8e6df'}`,
        background: '#fff',
        cursor: 'pointer',
        boxShadow: rank === 1
          ? '0 4px 20px rgba(196,48,48,0.15)'
          : '0 2px 12px rgba(0,0,0,0.07)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
        animation: `fadeUp 0.5s ease ${(rank - 1) * 0.08}s both`,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-5px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.14)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = rank === 1 ? '0 4px 20px rgba(196,48,48,0.15)' : '0 2px 12px rgba(0,0,0,0.07)' }}
    >
      {/* カバー画像エリア */}
      <div style={{ position: 'relative', paddingBottom: '145%', background: '#f0ede8' }}>
        {cover
          ? <img src={cover} alt={manga.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top' }} onError={e => { e.currentTarget.style.display = 'none' }} />
          : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, color: '#ccc9c0' }}>📖</div>
        }
        {/* 順位バッジ */}
        <div style={{
          position: 'absolute', top: 8, left: 8,
          background: rankBg, color: '#fff',
          fontFamily: "'Courier New', monospace",
          fontSize: 11, fontWeight: 700,
          padding: '4px 9px', borderRadius: 4,
          letterSpacing: '0.08em',
        }}>
          {String(rank).padStart(2, '0')} {rankLabel}
        </div>
        {/* スコアバッジ */}
        {manga.score > 0 && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(250,249,245,0.92)',
            backdropFilter: 'blur(4px)',
            color: '#9a6a00', fontWeight: 700, fontSize: 12,
            padding: '4px 8px', borderRadius: 4,
            border: '1px solid rgba(0,0,0,0.08)',
          }}>
            ★ {(manga.score / 10).toFixed(1)}
          </div>
        )}
      </div>

      {/* 情報エリア */}
      <div style={{ padding: '12px 13px 14px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1820', lineHeight: 1.35, marginBottom: 7, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {manga.title_ja || manga.title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {(manga.tags?.[0]?.name || manga.genre) && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tagColor, background: tagColor + '18', border: `1px solid ${tagColor}35`, borderRadius: 3, padding: '2px 6px' }}>
              {manga.tags?.[0]?.name || manga.genre}
            </span>
          )}
          {manga.year && <span style={{ fontSize: 10, color: '#aaa8a0', fontFamily: "'Courier New', monospace" }}>{manga.year}</span>}
        </div>
      </div>
    </div>
  )
}

/* ── ランキング行（4位以下） ──────────────────────────────────────────────────── */
function RankingRow({ manga, rank, isMobile, onClick, animDelay }) {
  const cover    = getCoverUrl(manga)
  const tagColor = getTagColor(manga.tags?.[0]?.name || manga.genre)

  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '44px 60px 1fr 64px' : '52px 72px 1fr 88px 64px 52px',
        alignItems: 'center',
        padding: isMobile ? '10px 12px' : '11px 16px',
        borderBottom: rank < RANKING_COUNT ? '1px solid #f0ede8' : 'none',
        cursor: 'pointer',
        background: 'transparent',
        transition: 'background 0.12s',
        animation: `fadeUp 0.4s ease ${animDelay}s both`,
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#faf8f5'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      {/* 順位 */}
      <div style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700, color: '#c0bdb8', letterSpacing: '0.05em' }}>
        {String(rank).padStart(2, '0')}
      </div>

      {/* カバー */}
      <div style={{ paddingRight: 12 }}>
        {cover
          ? <img src={cover} alt={manga.title} style={{ width: isMobile ? 40 : 48, height: isMobile ? 56 : 68, objectFit: 'cover', objectPosition: 'center top', borderRadius: 4, display: 'block', border: '1px solid #e8e6df' }} onError={e => e.currentTarget.style.display = 'none'} />
          : <div style={{ width: isMobile ? 40 : 48, height: isMobile ? 56 : 68, borderRadius: 4, background: '#f0ede8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>📖</div>
        }
      </div>

      {/* タイトル＋タグ */}
      <div style={{ minWidth: 0, paddingRight: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1820', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
          {manga.title_ja || manga.title}
        </div>
        {(manga.tags?.[0]?.name || manga.genre) && (
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: tagColor, background: tagColor + '15', border: `1px solid ${tagColor}28`, borderRadius: 3, padding: '1px 5px' }}>
            {manga.tags?.[0]?.name || manga.genre}
          </span>
        )}
      </div>

      {/* スコア */}
      <div style={{ textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#9a6a00', fontFamily: "'Courier New', monospace" }}>
        {manga.score > 0 ? (manga.score / 10).toFixed(1) : '—'}
      </div>

      {!isMobile && (
        <div style={{ textAlign: 'right', fontSize: 12, color: '#aaa8a0', fontFamily: "'Courier New', monospace" }}>
          {manga.year || '—'}
        </div>
      )}

      {!isMobile && (
        <div style={{ textAlign: 'right', fontSize: 10, color: '#c43030', fontWeight: 600, whiteSpace: 'nowrap' }}>類似 →</div>
      )}
    </div>
  )
}

/* ── セールプラットフォームカード ────────────────────────────────────────────── */
function SalePlatformCard({ platform }) {
  const { platform: name, url, color, sales } = platform
  return (
    <div style={{ border: '1px solid #e8e6df', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 6px rgba(0,0,0,0.05)' }}>
      <a href={url} target="_blank" rel="noopener noreferrer"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', textDecoration: 'none', borderBottom: '1px solid #f0ede8', transition: 'background 0.12s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#faf8f5'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}60` }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1820', flex: 1 }}>{name}</span>
        <span style={{ fontSize: 11, color: '#aaa8a0' }}>↗</span>
      </a>
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(!sales || sales.length === 0)
          ? <div style={{ fontSize: 12, color: '#c0bdb8', padding: '6px 4px' }}>現在のセール情報なし</div>
          : sales.map((s, i) => <SaleItem key={i} sale={s} color={color} />)
        }
      </div>
    </div>
  )
}

function SaleItem({ sale, color }) {
  const daysLeft = sale.end_date ? Math.ceil((new Date(sale.end_date) - new Date()) / 864e5) : null
  const urgent   = daysLeft !== null && daysLeft <= 3
  return (
    <a href={sale.url} target="_blank" rel="noopener noreferrer"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 11px', borderRadius: 7, textDecoration: 'none', background: '#faf8f5', border: `1px solid ${urgent ? '#f0c0c0' : '#edeae5'}`, transition: 'border-color 0.12s, background 0.12s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = urgent ? '#c43030' : '#d8d5ce'; e.currentTarget.style.background = '#f5f2ed' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = urgent ? '#f0c0c0' : '#edeae5'; e.currentTarget.style.background = '#faf8f5' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1820' }}>{sale.title}</span>
          {sale.badge && (
            <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color, border: `1px solid ${color}60`, borderRadius: 3, padding: '1px 5px', flexShrink: 0 }}>{sale.badge}</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#8a8880' }}>{sale.description}</div>
      </div>
      {daysLeft !== null && (
        <div style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: urgent ? '#c43030' : '#8a8880', background: urgent ? '#fff0f0' : '#f0ede8', border: `1px solid ${urgent ? '#f0c0c0' : '#e0ddd8'}`, borderRadius: 5, padding: '4px 8px', textAlign: 'center', lineHeight: 1.4, fontFamily: "'Courier New', monospace" }}>
          {daysLeft <= 0 ? '本日' : `残${daysLeft}日`}
        </div>
      )}
    </a>
  )
}
