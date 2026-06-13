import { useState, useEffect } from 'react'
import { getTagColor, getTagColorVivid } from '../utils'
import { getTagLabel } from '../tagTranslations'
import { getCoverUrl, getAffiliateUrl } from '../lib/imageSource'
import ReviewSection from './ReviewSection'
import NextReadsSection from './NextReadsSection'
import CommunityTagSection from './CommunityTagSection'
import SynopsisTranslation from './SynopsisTranslation'
import AddToListModal from './AddToListModal'
import ListSection from './ListSection'

// ── コミュニティ投票: localStorage 永続化 ────────────────────────────────────
const VOTED_STORAGE_KEY = 'community-tag-votes-v2'
function loadAllVoted() {
  try { return JSON.parse(localStorage.getItem(VOTED_STORAGE_KEY)) || {} } catch { return {} }
}
function saveAllVoted(obj) {
  try { localStorage.setItem(VOTED_STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

// ── タグ行の小さな投票ボタン ─────────────────────────────────────────────────
function InlineVoteBtn({ direction, active, disabled, onClick, tagName }) {
  const isUp = direction === 'up'
  const activeColor = isUp ? '#22c55e' : '#ef4444'
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      aria-label={`${tagName || 'タグ'}を${isUp ? '賛成' : '反対'}票`}
      aria-pressed={active}
      style={{
        background: active ? `rgba(${isUp ? '34,197,94' : '239,68,68'},0.22)` : 'transparent',
        border: `1px solid ${active ? activeColor : activeColor + '44'}`,
        borderRadius: 5, color: active ? activeColor : activeColor + '88',
        cursor: disabled ? 'default' : 'pointer',
        width: 32, height: 32, fontSize: 11, lineHeight: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        opacity: disabled && !active ? 0.3 : 1,
        transition: 'background 0.12s, border-color 0.12s',
        padding: 0,
      }}
    >{isUp ? '↑' : '↓'}</button>
  )
}

function getSimilarityReasons(manga, neighbor) {
  const aTagMap = new Map(manga.tags.map(t => [t.name, t]))
  return neighbor.tags
    .filter(t => !t.spoiler && aTagMap.has(t.name))
    .map(t => ({ ...t, rankSelf: aTagMap.get(t.name).rank }))
    .sort((a, b) => b.rank - a.rank)
}

function CoverImg({ manga, width, height, borderRadius = 8, style = {}, href }) {
  const url   = getCoverUrl(manga)
  const color = getTagColor(manga.tags?.[0]?.name || manga.genre)

  const inner = !url ? (
    <div style={{
      width, height, borderRadius, flexShrink: 0,
      background: `linear-gradient(160deg, ${color}40 0%, ${color}14 100%)`,
      border: `1px solid ${color}30`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      ...style,
    }}>
      <span style={{ fontSize: 28, opacity: 0.3 }}>📖</span>
    </div>
  ) : (
    <img
      src={url}
      alt={manga.title}
      style={{
        width, height, borderRadius, flexShrink: 0,
        objectFit: 'cover', objectPosition: 'center top',
        display: 'block',
        border: `1px solid ${color}40`,
        boxShadow: `0 6px 20px rgba(0,0,0,0.55)`,
        ...style,
      }}
      onError={e => { e.currentTarget.style.display = 'none' }}
    />
  )

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        title="楽天ブックスで見る"
        style={{ display: 'block', flexShrink: 0, lineHeight: 0 }}
      >
        {inner}
      </a>
    )
  }
  return inner
}

// タグバッジ：タグ名 + 数値 + 横バーの縦積みレイアウト
// mapWeight が渡された場合はアプリ独自の「マップ寄与度」を表示し、
// ラベルも "MAP WEIGHT" にする。渡されなければ AniList rank をそのまま表示。
function TagBadge({ tag, active, onClick, size = 'md', mapWeight, theme = 'light' }) {
  const color    = getTagColorVivid(tag.name, theme)
  const isSmall  = size === 'sm'
  const hasWeight    = mapWeight != null
  const displayValue = hasWeight ? mapWeight : tag.rank

  return (
    <div
      onClick={onClick ? () => onClick(tag.name) : undefined}
      title={onClick
        ? (active ? 'クリックで解除' : 'クリックで絞り込む')
        : (hasWeight ? 'このタグがマップ上の位置を決定した度合い' : undefined)}
      style={{
        display: 'inline-flex', flexDirection: 'column',
        gap: isSmall ? 4 : 5,
        padding: isSmall ? '5px 9px' : '7px 11px',
        borderRadius: isSmall ? 8 : 10,
        background: active ? `${color}30` : `${color}22`,
        border: `1.5px solid ${active ? color + 'cc' : color + '88'}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        boxShadow: active ? `0 1px 4px rgba(0,0,0,0.08)` : 'none',
        userSelect: 'none',
        minWidth: isSmall ? 56 : 72,
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.background = `${color}3a`; e.currentTarget.style.borderColor = color + 'bb' } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.background = active ? `${color}30` : `${color}22`; e.currentTarget.style.borderColor = active ? color + 'cc' : color + '88' } }}
    >
      {/* タグ名 ＋ 数値 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: isSmall ? 9 : 11, fontWeight: 700,
          color: color,
          letterSpacing: '0.04em',
          lineHeight: 1,
        }}>
          {active && '✓ '}{getTagLabel(tag.name)}
        </span>
        <span style={{
          fontSize: isSmall ? 11 : 14, fontWeight: 800,
          color: color,
          lineHeight: 1, flexShrink: 0,
        }}>
          {displayValue}%
        </span>
      </div>

      {/* 横バー */}
      <div style={{
        height: isSmall ? 4 : 5,
        borderRadius: 3,
        background: color + '22',
      }}>
        <div style={{
          height: '100%',
          width: `${displayValue}%`,
          borderRadius: 3,
          background: `linear-gradient(to right, ${color}, ${color}88)`,
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* MAP WEIGHT ラベル（IDF ロード済み・大サイズのみ表示） */}
      {!isSmall && hasWeight && (
        <div style={{
          fontSize: 8, fontWeight: 600, color: color + '88',
          letterSpacing: '0.08em', textAlign: 'right', lineHeight: 1,
        }}>
          MAP WEIGHT
        </div>
      )}
    </div>
  )
}

/**
 * AniList の生 rank（0〜100）の代わりに、このアプリが座標計算に使った
 * 「マップ寄与度」を 0〜100 に正規化して返す。
 * 値が高いほど「このマンガのマップ上の位置を決定づけたタグ」を意味する。
 */
function computeMapWeights(tags, tagIdf) {
  if (!tagIdf || Object.keys(tagIdf).length === 0) return null
  const scores = tags
    .filter(t => !t.spoiler)
    .map(t => ({ name: t.name, raw: (t.rank / 100) * (tagIdf[t.name] || 1) }))
  const max = Math.max(...scores.map(s => s.raw), 0.001)
  return Object.fromEntries(scores.map(s => [s.name, Math.round((s.raw / max) * 100)]))
}

const POP_STAR_COLORS_DP = ['', '#64748b', '#94a3b8', '#d97706', '#ea580c', '#dc2626']
const POP_LABELS_DP = ['', 'データなし', 'マイナー', '中堅人気', '人気作', '覇権']

// 同名タグを除去（rankが最大のものを残す）
function dedupeTags(tags) {
  const map = new Map()
  for (const t of tags) {
    const existing = map.get(t.name)
    if (!existing || t.rank > existing.rank) map.set(t.name, t)
  }
  return [...map.values()]
}

export default function DetailPanel({ manga, neighbors, tagIdf = {}, onClose, onSelect, onSelectSimilarMap, onOpenSimilarMap, showSimilarMap, selectedTags = [], onTagClick, onClearTags, isFavorite = false, onToggleFavorite, isViewed = false, onToggleViewed, isMobile = false, mapMode = false, neighborOnlyMode = false, onToggleNeighborMode, allManga = [], communityMode = false, onToggleCommunityMode, fullscreen = false, onToggleFullscreen, onGoToMap, minPopularity = 1, onPopularityChange, theme = 'light', onCommunityDataChange, communityData = null, authToken = null, currentUser = null }) {
  const primaryColor = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const mapWeights   = computeMapWeights(manga.tags || [], tagIdf)
  const isDark = theme === 'dark'
  const UI = isDark ? {
    bg: '#111827',
    bgAlt: '#0d1117',
    surface: 'rgba(255,255,255,0.05)',
    border: '#1e2535',
    borderSoft: '#252f42',
    text: '#e2e8f0',
    textTitle: '#e2e8f0',
    textAlt: '#6b7280',
    sub: '#9ca3af',
    muted: '#6b7280',
    muteLight: '#4b5563',
    accent: '#818cf8',
    accentBg: 'rgba(129,140,248,0.12)',
    accentBorder: 'rgba(129,140,248,0.4)',
    btnBg: 'rgba(255,255,255,0.04)',
    btnBorder: '#1e2535',
    btnText: '#9ca3af',
    overlayBg: 'rgba(13,17,23,0.97)',
    closeHandleBg: 'rgba(13,17,23,0.90)',
    closeHandleHover: 'rgba(30,37,53,0.96)',
    trackBg: 'rgba(255,255,255,0.08)',
    synopsisText: '#94a3b8',
    scoreColor: '#d97706',
    scoreBg: 'rgba(217,119,6,0.12)',
    scoreBorder: 'rgba(217,119,6,0.28)',
    mapBadgeBg: 'rgba(255,255,255,0.06)',
    mapBadgeBorder: '#1e2535',
    mapBadgeText: '#9ca3af',
    handleColor: '#2d3748',
    coverGradient: 'linear-gradient(180deg, rgba(13,17,23,0.95) 0%, rgba(13,17,23,0.75) 40%, rgba(13,17,23,0.90) 70%, rgba(13,17,23,1) 100%)',
  } : {
    bg: '#faf9f5',
    bgAlt: '#f5f4f0',
    surface: '#f8faff',
    border: '#e5e9f2',
    borderSoft: '#e8e6df',
    text: '#1f2937',
    textTitle: '#1a1820',
    textAlt: '#b8b4b0',
    sub: '#6b7280',
    muted: '#9aa1b2',
    muteLight: '#c0bdb8',
    accent: '#6d6af8',
    accentBg: 'rgba(109,106,248,0.10)',
    accentBorder: 'rgba(109,106,248,0.35)',
    btnBg: '#faf9f5',
    btnBorder: '#e0ddd8',
    btnText: '#8a8880',
    overlayBg: 'rgba(250,249,245,0.97)',
    closeHandleBg: 'rgba(250,249,245,0.90)',
    closeHandleHover: 'rgba(240,238,232,0.96)',
    trackBg: '#f0ede8',
    synopsisText: '#475569',
    scoreColor: '#d97706',
    scoreBg: 'rgba(217,119,6,0.08)',
    scoreBorder: 'rgba(217,119,6,0.22)',
    mapBadgeBg: 'rgba(0,0,0,0.04)',
    mapBadgeBorder: '#e0ddd8',
    mapBadgeText: '#c0bdb8',
    handleColor: '#d5dbea',
    coverGradient: 'linear-gradient(180deg, rgba(250,249,245,0.95) 0%, rgba(250,249,245,0.75) 40%, rgba(250,249,245,0.90) 70%, rgba(250,249,245,1) 100%)',
  }

  // ── コミュニティ タグ投票 ────────────────────────────────────────────────────
  const [allVoted, setAllVoted] = useState(loadAllVoted)
  const mangaVoted = (communityMode && manga?.id) ? (allVoted[manga.id] || {}) : {}

  function markVoted(key, direction) {
    setAllVoted(prev => {
      const next = { ...prev, [manga.id]: { ...(prev[manga.id] || {}), [key]: direction } }
      saveAllVoted(next)
      return next
    })
  }
  function unmarkVoted(key) {
    setAllVoted(prev => {
      const mg = { ...(prev[manga.id] || {}) }
      delete mg[key]
      const next = { ...prev, [manga.id]: mg }
      saveAllVoted(next)
      return next
    })
  }
  function voteDefault(tagName, delta) {
    const key = `default_${tagName}`
    if (mangaVoted[key]) return
    markVoted(key, delta > 0 ? 'up' : 'down')
    const prevData = communityData
    const updated = {
      ...(communityData || {}),
      default_tag_votes: {
        ...(communityData?.default_tag_votes || {}),
        [tagName]: {
          upvotes:   (communityData?.default_tag_votes?.[tagName]?.upvotes   ?? 0) + (delta > 0 ? 1 : 0),
          downvotes: (communityData?.default_tag_votes?.[tagName]?.downvotes ?? 0) + (delta < 0 ? 1 : 0),
        },
      },
    }
    onCommunityDataChange?.(updated)
    fetch(`/api/manga/${encodeURIComponent(manga.id)}/default-tags/${encodeURIComponent(tagName)}/vote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    })
      .then(r => { if (!r.ok) throw new Error() })
      .catch(() => { unmarkVoted(key); onCommunityDataChange?.(prevData) })
  }

  // マップ表示中は最初から最小化（マップを隠さないため）
  const [minimized, setMinimized] = useState(mapMode && isMobile)
  const [fsTab, setFsTab] = useState('synopsis')
  const [showListModal, setShowListModal] = useState(false)

  useEffect(() => {
    setMinimized(mapMode && isMobile)
  }, [manga.id, mapMode, isMobile]) // eslint-disable-line

  // Escape キーで全画面終了
  useEffect(() => {
    if (!fullscreen) return
    const handler = e => { if (e.key === 'Escape') onToggleFullscreen?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fullscreen]) // eslint-disable-line

  const mobileStyle = {
    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
    height: '75vh',
    background: UI.bg,
    borderTop: `2px solid ${primaryColor}55`,
    borderRadius: '20px 20px 0 0',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
    animation: 'slideUp 0.25s ease',
    boxShadow: '0 -12px 40px rgba(15,23,42,0.12)',
  }
  const desktopStyle = {
    width: 500, height: '100%',
    background: UI.bg,
    borderLeft: `1px solid ${UI.border}`,
    display: 'flex', flexDirection: 'column',
    // NOTE: keep overflow visible so the left-side close tab can protrude outside the panel
    overflow: 'visible',
    animation: 'slideIn 0.22s ease',
    flexShrink: 0,
    boxShadow: '-12px 0 36px rgba(15,23,42,0.08)',
  }

  // mapMode 時は他のマップオーバーレイ（zIndex 60-65）より上に出す
  const panelZ = mapMode ? 70 : 50

  // ── ミニバー（最小化状態）──────────────────────────────────────────────
  if (isMobile && minimized) {
    return (
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: panelZ,
        height: 72,
        background: UI.overlayBg,
        backdropFilter: 'blur(20px)',
        borderTop: `2px solid ${primaryColor}44`,
        borderRadius: '12px 12px 0 0',
        display: 'flex', alignItems: 'center',
        padding: '0 10px',
        gap: 10,
        boxShadow: '0 -4px 30px rgba(0,0,0,0.10)',
        animation: 'slideUp 0.2s ease',
      }}>
        {/* カバー */}
        <CoverImg manga={manga} width={44} height={60} borderRadius={6} />

        {/* 情報（タップで展開） */}
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setMinimized(false)}>
          <div style={{ fontSize: 13, fontWeight: 700, color: UI.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
            {manga.title_ja || manga.title}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 8px', marginTop: 3, alignItems: 'center' }}>
            {manga.score > 0 && (
              <span style={{ fontSize: 11, color: UI.scoreColor, fontWeight: 700 }}>★ {(manga.score / 10).toFixed(1)}</span>
            )}
            {manga.year && (
              <span style={{ fontSize: 11, color: UI.sub }}>{manga.year}</span>
            )}
            {(manga.genre || manga.tags?.[0]?.name) && (
              <span style={{ fontSize: 10, color: primaryColor + 'cc', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {manga.genre || manga.tags?.[0]?.name}
              </span>
            )}
          </div>
        </div>

        {/* ボタン列 */}
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {onOpenSimilarMap && (
            <button
              onClick={onOpenSimilarMap}
              title="類似作品マップを開く"
              style={{
                background: showSimilarMap ? UI.accentBg : UI.btnBg,
                border: `1px solid ${showSimilarMap ? UI.accentBorder : UI.border}`,
                borderRadius: 6, cursor: 'pointer',
                padding: '0 8px', height: 28, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 3,
                color: showSimilarMap ? UI.accent : UI.sub,
              }}
            >
              <span style={{ fontSize: 11 }}>⬡</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>類似</span>
            </button>
          )}
          {onToggleNeighborMode && (
            <button
              onClick={onToggleNeighborMode}
              title={neighborOnlyMode ? '全作品を表示' : '近傍のみ表示'}
              style={{
                background: neighborOnlyMode ? UI.accentBg : UI.btnBg,
                border: `1px solid ${neighborOnlyMode ? UI.accentBorder : UI.border}`,
                borderRadius: 6, cursor: 'pointer',
                padding: '0 8px', height: 28, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 3,
                color: neighborOnlyMode ? UI.accent : UI.sub,
              }}
            >
              <span style={{ fontSize: 11 }}>{neighborOnlyMode ? '★' : '☆'}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>近傍</span>
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: UI.btnBg, border: `1px solid ${UI.btnBorder}`,
              borderRadius: 6, color: UI.btnText, cursor: 'pointer',
              height: 28, fontSize: 11, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 8px', gap: 3,
            }}
          >
            <span>＞</span>
            <span style={{ fontSize: 10 }}>閉じる</span>
          </button>
        </div>
      </div>
    )
  }

  // ── 全画面モード ─────────────────────────────────────────────────────────────
  const coverUrl = getCoverUrl(manga)

  if (fullscreen && !isMobile) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex',
        background: UI.bgAlt,
        animation: 'fadeUp 0.20s ease',
      }}>

        {/* ── 左パネル: カバーアート + 基本情報 ──────────────────────── */}
        <div style={{
          width: 300, flexShrink: 0,
          position: 'relative',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          borderRight: `1px solid ${UI.borderSoft}`,
          background: UI.bg,
        }}>
          {/* 背景: ぼかしカバーアート */}
          {coverUrl && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <img src={coverUrl} alt="" style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                filter: 'blur(48px) saturate(1.2)',
                opacity: isDark ? 0.06 : 0.08,
                transform: 'scale(1.12)',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: UI.coverGradient,
              }} />
            </div>
          )}

          {/* ジャンルインジケーター */}
          <div style={{
            position: 'relative', zIndex: 1,
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: `1px solid ${UI.borderSoft}`,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: primaryColor, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: primaryColor + 'bb', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
              {manga.genre || manga.tags?.[0]?.name || ''}
            </span>
          </div>

          {/* カバー画像 */}
          <div style={{
            position: 'relative', zIndex: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px 28px 14px',
          }}>
            <div style={{ position: 'relative' }}>
              <CoverImg
                manga={manga}
                width={196} height={278}
                borderRadius={14}
                href={getAffiliateUrl(manga)}
                style={{ boxShadow: `0 20px 50px rgba(0,0,0,0.75), 0 0 0 1px ${primaryColor}33` }}
              />
              <div style={{
                position: 'absolute', inset: -10, zIndex: -1,
                background: primaryColor + '15',
                borderRadius: 22,
                filter: 'blur(18px)',
              }} />
            </div>
          </div>

          {/* タイトル + メタ情報 + ボタン */}
          <div style={{ position: 'relative', zIndex: 1, padding: '0 20px 20px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: UI.textTitle, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                {manga.title_ja || manga.title}
              </div>
              {manga.title_ja && manga.title_ja !== manga.title && (
                <div style={{ fontSize: 11, color: UI.textAlt, marginTop: 3, lineHeight: 1.4 }}>{manga.title}</div>
              )}
            </div>

            {/* スコア・年・リンク */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {manga.score > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700, color: UI.scoreColor, background: UI.scoreBg, border: `1px solid ${UI.scoreBorder}`, borderRadius: 7, padding: '3px 9px' }}>
                  ★ {(manga.score / 10).toFixed(1)}
                </span>
              )}
              {manga.year && (
                <span style={{ fontSize: 12, color: UI.btnText, background: UI.btnBg, border: `1px solid ${UI.btnBorder}`, borderRadius: 7, padding: '3px 9px' }}>
                  {manga.year}
                </span>
              )}
              {manga.url && (
                <a href={manga.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: UI.btnText, textDecoration: 'none', border: `1px solid ${UI.btnBorder}`, borderRadius: 6, padding: '3px 8px', background: UI.btnBg, transition: 'color 0.15s, border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#c43030'; e.currentTarget.style.borderColor = isDark ? 'rgba(196,48,48,0.5)' : '#e8d0d0' }}
                  onMouseLeave={e => { e.currentTarget.style.color = UI.btnText; e.currentTarget.style.borderColor = UI.btnBorder }}
                >AniList ↗</a>
              )}
            </div>

            {/* アクションボタン */}
            <div style={{ display: 'flex', gap: 7, marginTop: 2 }}>
              {onToggleViewed && (
                <button onClick={onToggleViewed} aria-label={isViewed ? '既読を解除' : '既読にする'} aria-pressed={isViewed} style={{
                  padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                  background: isViewed ? 'rgba(8,145,178,0.12)' : UI.btnBg,
                  border: `1px solid ${isViewed ? '#0891b2' : UI.btnBorder}`,
                  color: isViewed ? '#0891b2' : UI.btnText, fontSize: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'all 0.15s',
                  minWidth: 44, minHeight: 44,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(8,145,178,0.18)'; e.currentTarget.style.borderColor = '#0891b2'; e.currentTarget.style.color = '#0891b2' }}
                onMouseLeave={e => { e.currentTarget.style.background = isViewed ? 'rgba(8,145,178,0.12)' : UI.btnBg; e.currentTarget.style.borderColor = isViewed ? '#0891b2' : UI.btnBorder; e.currentTarget.style.color = isViewed ? '#0891b2' : UI.btnText }}
                >{isViewed ? '◷' : '○'}</button>
              )}
              {onToggleFavorite && (
                <button onClick={onToggleFavorite} aria-label={isFavorite ? 'お気に入りから削除' : 'お気に入りに追加'} aria-pressed={isFavorite} style={{
                  flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                  background: isFavorite ? 'rgba(244,114,182,0.12)' : UI.btnBg,
                  border: `1px solid ${isFavorite ? '#f472b6' : UI.btnBorder}`,
                  color: isFavorite ? '#f472b6' : UI.btnText, fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all 0.15s',
                  minHeight: 44,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,114,182,0.18)'; e.currentTarget.style.borderColor = '#f472b6'; e.currentTarget.style.color = '#f472b6' }}
                onMouseLeave={e => { e.currentTarget.style.background = isFavorite ? 'rgba(244,114,182,0.12)' : UI.btnBg; e.currentTarget.style.borderColor = isFavorite ? '#f472b6' : UI.btnBorder; e.currentTarget.style.color = isFavorite ? '#f472b6' : UI.btnText }}
                >{isFavorite ? '♥' : '♡'} {isFavorite ? 'お気に入り' : 'お気に入り'}</button>
              )}
              {authToken && (
                <button onClick={() => setShowListModal(true)} aria-label="リストに追加" title="リストに追加" style={{
                  padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                  background: UI.btnBg, border: `1px solid ${UI.btnBorder}`,
                  color: UI.btnText, fontSize: 13, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, transition: 'all 0.15s',
                  minWidth: 44, minHeight: 44,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
                onMouseLeave={e => { e.currentTarget.style.background = UI.btnBg; e.currentTarget.style.borderColor = UI.btnBorder; e.currentTarget.style.color = UI.btnText }}
                ><span aria-hidden="true">📋</span></button>
              )}
              {onOpenSimilarMap && (
                <button onClick={onOpenSimilarMap} aria-label="類似作品の2Dマップを開く" title="類似作品の2Dマップを開く" style={{
                  padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                  background: showSimilarMap ? 'rgba(196,48,48,0.10)' : UI.btnBg,
                  border: `1px solid ${showSimilarMap ? '#c43030' : UI.btnBorder}`,
                  color: showSimilarMap ? '#c43030' : UI.btnText, fontSize: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                  minWidth: 44, minHeight: 44,
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.14)'; e.currentTarget.style.borderColor = '#c43030'; e.currentTarget.style.color = '#c43030' }}
                onMouseLeave={e => { e.currentTarget.style.background = showSimilarMap ? 'rgba(196,48,48,0.10)' : UI.btnBg; e.currentTarget.style.borderColor = showSimilarMap ? '#c43030' : UI.btnBorder }}
                >⬡</button>
              )}
            </div>

            {/* マップへ直接移動 */}
            {onGoToMap && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button
                  onClick={() => onGoToMap('3d')}
                  title="3Dマップで類似作品を探索"
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: UI.btnBg, border: `1px solid ${UI.btnBorder}`,
                    color: UI.btnText, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = isDark ? '#4b5563' : '#c0bdb8'; e.currentTarget.style.color = UI.textTitle }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = UI.btnBorder; e.currentTarget.style.color = UI.btnText }}
                >
                  <span style={{ fontSize: 14 }}>◈</span> 3Dマップ
                </button>
                <button
                  onClick={() => onGoToMap('2d')}
                  title="2D類似マップで探索"
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: 'rgba(196,48,48,0.06)', border: `1px solid ${isDark ? 'rgba(196,48,48,0.30)' : '#e8d0d0'}`,
                    color: '#c43030', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.12)'; e.currentTarget.style.borderColor = '#c43030' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.06)'; e.currentTarget.style.borderColor = isDark ? 'rgba(196,48,48,0.30)' : '#e8d0d0' }}
                >
                  <span style={{ fontSize: 14 }}>⬡</span> 2Dマップ
                </button>
              </div>
            )}

            {/* 絞り込みバナー */}
            {selectedTags.length > 0 && (
              <div style={{ padding: '8px 10px', background: 'rgba(196,48,48,0.06)', border: `1px solid ${isDark ? 'rgba(196,48,48,0.28)' : 'rgba(196,48,48,0.20)'}`, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#c43030', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, flexShrink: 0 }}>絞り込み中</span>
                {selectedTags.map(name => {
                  const color = getTagColorVivid(name, theme)
                  return <span key={name} onClick={() => onTagClick(name)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6, background: `${color}28`, border: `1px solid ${color}80`, color, cursor: 'pointer' }}>{name} <span style={{ opacity: 0.6 }}>✕</span></span>
                })}
                <button onClick={onClearTags} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: UI.muted, cursor: 'pointer', fontSize: 10 }} onMouseEnter={e => e.currentTarget.style.color = UI.sub} onMouseLeave={e => e.currentTarget.style.color = UI.muted}>解除</button>
              </div>
            )}
          </div>
        </div>

        {/* ── 中央パネル: あらすじ + レビュー ──────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${UI.borderSoft}` }}>

          {/* トップバー: ボタン群 */}
          <div style={{
            flexShrink: 0, height: 48,
            borderBottom: `1px solid ${UI.borderSoft}`,
            display: 'flex', alignItems: 'center',
            padding: '0 18px', gap: 6,
          }}>
            {/* マップ遷移ボタン（左側） */}
            {onGoToMap && (
              <div style={{ display: 'flex', gap: 5, marginRight: 'auto' }}>
                <button
                  onClick={() => onGoToMap('3d')}
                  style={{ background: UI.btnBg, border: `1px solid ${UI.btnBorder}`, borderRadius: 7, cursor: 'pointer', padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', gap: 5, color: UI.btnText, fontSize: 11, fontWeight: 600, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = isDark ? '#4b5563' : '#c0bdb8'; e.currentTarget.style.color = UI.textTitle }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = UI.btnBorder; e.currentTarget.style.color = UI.btnText }}
                ><span>◈</span> 3Dマップ</button>
                <button
                  onClick={() => onGoToMap('2d')}
                  style={{ background: 'rgba(196,48,48,0.06)', border: `1px solid ${isDark ? 'rgba(196,48,48,0.30)' : '#e8d0d0'}`, borderRadius: 7, cursor: 'pointer', padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', gap: 5, color: '#c43030', fontSize: 11, fontWeight: 600, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.12)'; e.currentTarget.style.borderColor = '#c43030' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.06)'; e.currentTarget.style.borderColor = isDark ? 'rgba(196,48,48,0.30)' : '#e8d0d0' }}
                ><span>⬡</span> 2Dマップ</button>
              </div>
            )}
            {onToggleCommunityMode && (
              <button onClick={onToggleCommunityMode} aria-label={communityMode ? 'コミュニティモードをオフ' : 'コミュニティモードをオン'} aria-pressed={communityMode} title={communityMode ? 'コミュニティモードをオフ' : 'コミュニティモードをオン'}
                style={{ background: communityMode ? 'rgba(196,48,48,0.10)' : UI.btnBg, border: `1px solid ${communityMode ? '#c43030' : UI.btnBorder}`, borderRadius: 7, cursor: 'pointer', padding: '0 10px', minHeight: 44, display: 'flex', alignItems: 'center', gap: 5, color: communityMode ? '#c43030' : UI.btnText, fontSize: 11, fontWeight: 700, transition: 'all 0.15s' }}>
                <span aria-hidden="true" style={{ fontSize: 12 }}>{communityMode ? '◉' : '◎'}</span> Community
              </button>
            )}
            <button onClick={onToggleFullscreen} aria-label="全画面を終了" title="全画面を終了 (Esc)"
              style={{ background: UI.btnBg, border: `1px solid ${UI.btnBorder}`, borderRadius: 7, color: UI.btnText, cursor: 'pointer', width: 44, height: 44, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c43030'; e.currentTarget.style.color = '#c43030' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = UI.btnBorder; e.currentTarget.style.color = UI.btnText }}
            >⛶</button>
            <button onClick={onClose} aria-label="詳細パネルを閉じる"
              style={{ background: UI.btnBg, border: `1px solid ${UI.btnBorder}`, borderRadius: 7, color: UI.btnText, cursor: 'pointer', width: 44, height: 44, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = UI.surface}
              onMouseLeave={e => e.currentTarget.style.background = UI.btnBg}
            >✕</button>
          </div>

          {/* スクロールコンテンツ */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 48px' }}>

            {/* あらすじ + コミュニティ翻訳 */}
            <SynopsisTranslation
              mangaId={manga.id}
              fallbackSynopsis={manga.synopsis}
              primaryColor={primaryColor}
              theme={theme}
              fontSize={15}
              fullscreen
            />

            <div style={{ borderBottom: `1px solid ${UI.borderSoft}`, marginBottom: 28 }} />

            {/* Community タグ */}
            {communityMode && (
              <>
                <CommunityTagSection mangaId={manga.id} theme={theme} onDataChange={onCommunityDataChange} />
                <div style={{ borderBottom: `1px solid ${UI.borderSoft}`, margin: '28px 0' }} />
              </>
            )}

            {/* レビュー（メインコンテンツ） */}
            <ReviewSection mangaId={manga.id} primaryColor={primaryColor} authToken={authToken} currentUser={currentUser} theme={theme} />

            {/* Next Reads */}
            <NextReadsSection mangaId={manga.id} allManga={allManga} onSelect={onSelect} onSelectSimilarMap={onSelectSimilarMap} primaryColor={primaryColor} authToken={authToken} currentUser={currentUser} theme={theme} />

            {/* このリストに収録 */}
            <ListSection mangaId={manga.id} theme={theme} />
          </div>
        </div>

        {/* ── 右パネル: タグランク + 類似作品 ─────────────────────────── */}
        <div style={{ width: 310, flexShrink: 0, display: 'flex', flexDirection: 'column', background: UI.bgAlt }}>

          {/* トップバー（右、高さ合わせ） */}
          <div style={{ flexShrink: 0, height: 48, borderBottom: `1px solid ${UI.borderSoft}` }} />

          {/* スクロールコンテンツ */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 48px' }}>

            {/* タグランク評価 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, color: UI.muteLight, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
                Tag Rankings
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {dedupeTags(manga.tags).slice(0, 20).map(tag => {
                  const color = getTagColorVivid(tag.name, theme)
                  const mw = mapWeights?.[tag.name]
                  const displayVal = mw ?? tag.rank
                  const active = selectedTags.includes(tag.name)
                  const voted = mangaVoted[`default_${tag.name}`]
                  const votes = communityData?.default_tag_votes?.[tag.name] || { upvotes: 0, downvotes: 0 }
                  const net = votes.upvotes - votes.downvotes
                  return (
                    <div
                      key={tag.name}
                      onClick={() => onTagClick?.(tag.name)}
                      title={active ? 'クリックで解除' : 'クリックで絞り込む'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 8, cursor: onTagClick ? 'pointer' : 'default',
                        background: active ? `${color}18` : UI.btnBg,
                        border: `1px solid ${active ? color + '60' : UI.borderSoft}`,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { if (onTagClick) { e.currentTarget.style.background = `${color}14`; e.currentTarget.style.borderColor = color + '55' } }}
                      onMouseLeave={e => { if (onTagClick) { e.currentTarget.style.background = active ? `${color}18` : UI.btnBg; e.currentTarget.style.borderColor = active ? color + '60' : UI.borderSoft } }}
                    >
                      {/* タグ名 */}
                      <span style={{ flex: 1, fontSize: 11, fontWeight: active ? 700 : 500, color: active ? color : color + 'cc', letterSpacing: '0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {active && '✓ '}{getTagLabel(tag.name)}
                      </span>
                      {/* パーセント値 */}
                      <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>{displayVal}%</span>
                      {/* バー */}
                      <div style={{ width: 48, height: 4, borderRadius: 3, background: UI.trackBg, flexShrink: 0, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${displayVal}%`, background: `linear-gradient(to right, ${color}, ${color}66)` }} />
                      </div>
                      {/* コミュニティ投票ボタン */}
                      {communityMode && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                          {net !== 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: 'right', color: net > 0 ? '#22c55e88' : '#ef444488' }}>
                              {net > 0 ? '+' : ''}{net}
                            </span>
                          )}
                          <InlineVoteBtn direction="up"   active={voted === 'up'}   disabled={!!voted} onClick={() => voteDefault(tag.name, 1)} tagName={tag.name} />
                          <InlineVoteBtn direction="down" active={voted === 'down'} disabled={!!voted} onClick={() => voteDefault(tag.name, -1)} tagName={tag.name} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ borderBottom: `1px solid ${UI.borderSoft}`, marginBottom: 20 }} />

            {/* 類似作品（コンパクト） */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: UI.muteLight, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, flex: 1 }}>
                  Similar Works
                </div>
                {onPopularityChange && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {[1,2,3,4,5].map(n => {
                      const active = n >= minPopularity
                      const col = active ? POP_STAR_COLORS_DP[n] : (isDark ? '#374151' : '#d1d5db')
                      return (
                        <button key={n}
                          onClick={() => onPopularityChange(n === minPopularity ? 1 : n)}
                          title={POP_LABELS_DP[n]}
                          style={{ background: 'none', border: 'none', padding: '1px 2px', cursor: 'pointer', fontSize: 12, color: col, lineHeight: 1, transition: 'color 0.12s' }}
                        >★</button>
                      )
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {neighbors.slice(0, 8).map((neighbor, i) => {
                  const nColor = getTagColor(neighbor.tags?.[0]?.name || neighbor.genre)
                  const simPct = Math.max(15, 100 - (neighbor.distance || 0) * 110)
                  return (
                    <button
                      key={neighbor.id}
                      onClick={() => onSelect(neighbor)}
                      style={{
                        background: UI.btnBg, border: `1px solid ${UI.borderSoft}`,
                        borderRadius: 10, padding: '10px 12px',
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', gap: 10, alignItems: 'center',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = nColor + '70'; e.currentTarget.style.background = nColor + '08' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = UI.borderSoft; e.currentTarget.style.background = UI.btnBg }}
                    >
                      {/* 順位 */}
                      <span style={{ fontSize: 11, fontWeight: 700, color: nColor + '99', flexShrink: 0, width: 16, textAlign: 'right' }}>{i + 1}</span>
                      {/* サムネ */}
                      <CoverImg manga={neighbor} width={36} height={50} borderRadius={5} style={{ flexShrink: 0 }} />
                      {/* 情報 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: UI.textTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                          {neighbor.title_ja || neighbor.title}
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: UI.trackBg, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 2, width: `${simPct}%`, background: `linear-gradient(to right, ${nColor}cc, ${nColor}44)` }} />
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: nColor, flexShrink: 0 }}>{simPct.toFixed(0)}%</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {showListModal && authToken && (
        <AddToListModal
          manga={manga}
          authToken={authToken}
          theme={theme}
          onClose={() => setShowListModal(false)}
        />
      )}

      {/* モバイル: 背景オーバーレイ（mapMode ならタップで最小化、通常は閉じる） */}
      {isMobile && (
        <div
          onPointerDown={mapMode ? () => setMinimized(true) : onClose}
          style={{ position: 'fixed', inset: 0, zIndex: panelZ - 1, background: 'rgba(0,0,0,0.4)' }}
        />
      )}
    <div style={isMobile ? { ...mobileStyle, zIndex: panelZ } : { ...desktopStyle, position: 'relative' }}>

      {/* Desktop: left-side close handle (subtle) */}
      {!isMobile && (
        <button
          onClick={onClose}
          title="閉じる"
          aria-label="詳細を閉じる"
          style={{
            position: 'fixed',
            top: '50%',
            // Center the button on the panel boundary (panel width is 500px)
            right: 'calc(500px - 11px)',
            transform: 'translate(0, -50%)',
            width: 22,
            height: 44,
            borderRadius: 999,
            background: UI.closeHandleBg,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.14)'}`,
            boxShadow: isDark ? '0 8px 18px rgba(0,0,0,0.5)' : '0 8px 18px rgba(15,23,42,0.14)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: UI.textTitle,
            zIndex: 9999,
            backdropFilter: 'blur(14px) saturate(1.1)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
            transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            pointerEvents: 'auto',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = UI.closeHandleHover
            e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.20)'
            e.currentTarget.style.boxShadow = isDark ? '0 10px 24px rgba(0,0,0,0.6)' : '0 10px 24px rgba(15,23,42,0.18)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = UI.closeHandleBg
            e.currentTarget.style.borderColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.14)'
            e.currentTarget.style.boxShadow = isDark ? '0 8px 18px rgba(0,0,0,0.5)' : '0 8px 18px rgba(15,23,42,0.14)'
          }}
        >
          <span style={{ fontSize: 18, lineHeight: 1, fontWeight: 900, transform: 'translate(0.5px, -1px)' }}>›</span>
        </button>
      )}

      {/* モバイル: ハンドル（タップで最小化） */}
      {isMobile && (
        <div
          onClick={mapMode ? () => setMinimized(true) : undefined}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0 4px', flexShrink: 0, cursor: mapMode ? 'pointer' : 'default', gap: 4 }}
        >
          <div style={{ width: 44, height: 4, borderRadius: 2, background: UI.handleColor }} />
          {mapMode && <span style={{ fontSize: 10, color: UI.muted, letterSpacing: '0.06em' }}>▼ マップに戻る</span>}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: `1px solid ${UI.border}`,
        background: `linear-gradient(145deg, ${primaryColor}12 0%, transparent 60%)`,
        position: 'relative',
        padding: isMobile ? '14px 18px 14px' : '22px 22px 20px',
      }}>
        {/* Favorite + Fullscreen + Minimize + Close buttons */}
        <div style={{ position: 'absolute', top: 14, right: 14, display: 'flex', gap: 6, zIndex: 2 }}>
          {isMobile && mapMode && (
            <button
              onClick={() => setMinimized(true)}
              title="最小化してマップに戻る"
              style={{
                background: UI.btnBg, border: `1px solid ${UI.border}`,
                borderRadius: 8, color: UI.sub, cursor: 'pointer',
                width: 34, height: 34, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >▽</button>
          )}
          {isMobile && onToggleNeighborMode && (
            <button
              onClick={onToggleNeighborMode}
              title={neighborOnlyMode ? '全作品を表示' : '近傍のみ表示'}
              style={{
                background: neighborOnlyMode ? UI.accentBg : UI.btnBg,
                border: `1px solid ${neighborOnlyMode ? UI.accentBorder : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                padding: '0 8px', height: 34, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 3,
                color: neighborOnlyMode ? UI.accent : UI.sub,
              }}
            >
              <span style={{ fontSize: 13 }}>{neighborOnlyMode ? '★' : '☆'}</span>
              <span style={{ fontSize: 10, fontWeight: 600 }}>近傍</span>
            </button>
          )}
          {onToggleCommunityMode && (
            <button
              onClick={onToggleCommunityMode}
              title={communityMode ? 'コミュニティモードをオフにする' : 'コミュニティモード：タグへの投票や独自タグ追加ができます'}
              style={{
                background: communityMode ? UI.accentBg : UI.btnBg,
                border: `1px solid ${communityMode ? UI.accentBorder : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                padding: '0 8px', height: 34, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 4,
                color: communityMode ? UI.accent : UI.sub,
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                if (!communityMode) {
                  e.currentTarget.style.borderColor = UI.accentBorder
                  e.currentTarget.style.color = UI.accent
                }
              }}
              onMouseLeave={e => {
                if (!communityMode) {
                  e.currentTarget.style.borderColor = UI.border
                  e.currentTarget.style.color = UI.sub
                }
              }}
            >
              <span style={{ fontSize: 13 }}>{communityMode ? '◉' : '◎'}</span>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' }}>Community</span>
            </button>
          )}
          {onToggleViewed && (
            <button
              onClick={onToggleViewed}
              title={isViewed ? '閲覧済みから削除' : '閲覧済みにマーク'}
              style={{
                background: isViewed ? 'rgba(8,145,178,0.12)' : UI.btnBg,
                border: `1px solid ${isViewed ? '#0891b2' : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                width: 34, height: 34, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
                color: isViewed ? '#0891b2' : UI.sub,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(8,145,178,0.18)'
                e.currentTarget.style.borderColor = '#0891b2'
                e.currentTarget.style.color = '#0891b2'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isViewed ? 'rgba(8,145,178,0.12)' : UI.btnBg
                e.currentTarget.style.borderColor = isViewed ? '#0891b2' : UI.border
                e.currentTarget.style.color = isViewed ? '#0891b2' : UI.sub
              }}
            >
              {isViewed ? '◷' : '○'}
            </button>
          )}
          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              title={isFavorite ? 'お気に入りから削除' : 'お気に入りに追加'}
              style={{
                background: isFavorite ? 'rgba(244,114,182,0.12)' : UI.btnBg,
                border: `1px solid ${isFavorite ? '#f472b6' : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                width: 34, height: 34, fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
                color: isFavorite ? '#f472b6' : UI.sub,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(244,114,182,0.18)'
                e.currentTarget.style.borderColor = '#f472b6'
                e.currentTarget.style.color = '#f472b6'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = isFavorite ? 'rgba(244,114,182,0.12)' : UI.btnBg
                e.currentTarget.style.borderColor = isFavorite ? '#f472b6' : UI.border
                e.currentTarget.style.color = isFavorite ? '#f472b6' : UI.sub
              }}
            >
              {isFavorite ? '♥' : '♡'}
            </button>
          )}
          {authToken && (
            <button
              onClick={() => setShowListModal(true)}
              title="リストに追加"
              style={{
                background: UI.btnBg, border: `1px solid ${UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                width: 34, height: 34, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', color: UI.sub,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#6366f1'; e.currentTarget.style.color = '#6366f1' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = UI.border; e.currentTarget.style.color = UI.sub }}
            >📋</button>
          )}
          {/* 全画面トグル（デスクトップのみ） */}
          {!isMobile && (
            <button
              onClick={onToggleFullscreen}
              title={fullscreen ? '全画面を終了 (Esc)' : '全画面表示'}
              style={{
                background: fullscreen ? UI.accentBg : UI.btnBg,
                border: `1px solid ${fullscreen ? UI.accentBorder : UI.border}`,
                borderRadius: 8, color: fullscreen ? UI.accent : UI.sub, cursor: 'pointer',
                width: 34, height: 34, fontSize: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = UI.accentBorder; e.currentTarget.style.color = UI.accent }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = fullscreen ? UI.accentBorder : UI.border; e.currentTarget.style.color = fullscreen ? UI.accent : UI.sub }}
            >⛶</button>
          )}
          <button
            onClick={onClose}
            style={{
              background: UI.btnBg, border: `1px solid ${UI.border}`,
              borderRadius: 8, color: UI.sub, cursor: 'pointer',
              width: 34, height: 34, fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = UI.surface}
            onMouseLeave={e => e.currentTarget.style.background = UI.btnBg}
          >✕</button>
        </div>

        {/* カバー＋情報 横並び */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', paddingRight: 40 }}>
          <CoverImg manga={manga} width={136} height={194} borderRadius={10} href={getAffiliateUrl(manga)} />

          <div style={{ flex: 1, minWidth: 0, paddingTop: 38 }}>
            {/* ジャンルドット */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10,
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: primaryColor, boxShadow: `0 0 12px ${primaryColor}`,
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, color: primaryColor + 'cc', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
                {manga.genre || manga.tags?.[0]?.name || ''}
              </span>
            </div>

            {/* タイトル（日本語優先） */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 19, fontWeight: 700, color: UI.text, lineHeight: 1.35 }}>
                {manga.title_ja || manga.title}
              </div>
              {manga.title_ja && manga.title_ja !== manga.title && (
                <div style={{ fontSize: 13, color: UI.muted, marginTop: 3 }}>
                  {manga.title}
                </div>
              )}
            </div>

            {/* スコア・年・AniList */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              {manga.score > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 13, fontWeight: 700, color: UI.scoreColor,
                  background: UI.scoreBg, border: `1px solid ${UI.scoreBorder}`,
                  borderRadius: 8, padding: '3px 10px',
                }}>
                  ★ {(manga.score / 10).toFixed(1)}
                </span>
              )}
              {manga.year && (
                <span style={{
                  fontSize: 12, color: UI.sub,
                  background: UI.btnBg, border: `1px solid ${UI.border}`,
                  borderRadius: 8, padding: '3px 10px',
                }}>
                  {manga.year}
                </span>
              )}
              {manga.url && (
                <a
                  href={manga.url} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: 12, color: UI.sub, textDecoration: 'none',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = UI.accent}
                  onMouseLeave={e => e.currentTarget.style.color = UI.sub}
                >
                  AniList ↗
                </a>
              )}
            </div>

            {/* タグ（クリックで絞り込み / communityMode 時は投票ボタン付き行表示） */}
            {communityMode ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {dedupeTags(manga.tags).slice(0, 12).map(tag => {
                  const color  = getTagColorVivid(tag.name, theme)
                  const active = selectedTags.includes(tag.name)
                  const voted  = mangaVoted[`default_${tag.name}`]
                  const votes  = communityData?.default_tag_votes?.[tag.name] || { upvotes: 0, downvotes: 0 }
                  const net    = votes.upvotes - votes.downvotes
                  return (
                    <div key={tag.name} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 8px', borderRadius: 8,
                      background: active ? `${color}18` : UI.btnBg,
                      border: `1px solid ${active ? color + '60' : UI.borderSoft}`,
                    }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      <span
                        onClick={() => onTagClick?.(tag.name)}
                        style={{ flex: 1, fontSize: 11, fontWeight: active ? 700 : 500, color: active ? color : color + 'cc', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {active && '✓ '}{getTagLabel(tag.name)}
                      </span>
                      {net !== 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: net > 0 ? '#22c55e88' : '#ef444488', flexShrink: 0 }}>
                          {net > 0 ? '+' : ''}{net}
                        </span>
                      )}
                      <InlineVoteBtn direction="up"   active={voted === 'up'}   disabled={!!voted} onClick={() => voteDefault(tag.name, 1)} tagName={tag.name} />
                      <InlineVoteBtn direction="down" active={voted === 'down'} disabled={!!voted} onClick={() => voteDefault(tag.name, -1)} tagName={tag.name} />
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {dedupeTags(manga.tags).slice(0, 12).map(tag => {
                  const color  = getTagColorVivid(tag.name, theme)
                  const active = selectedTags.includes(tag.name)
                  const mw     = mapWeights?.[tag.name]
                  return (
                    <button
                      key={tag.name}
                      onClick={() => onTagClick?.(tag.name)}
                      title={active ? 'クリックで解除' : 'クリックで絞り込む'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '3px 9px 3px 7px',
                        borderRadius: 20,
                        background: active ? `${color}2a` : `${color}1c`,
                        border: `1px solid ${active ? color + 'cc' : color + '70'}`,
                        color: color,
                        fontSize: 11, fontWeight: active ? 700 : 500,
                        letterSpacing: '0.03em',
                        cursor: 'pointer',
                        transition: 'all 0.13s',
                        lineHeight: 1.3,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${color}32`; e.currentTarget.style.borderColor = color + 'aa' }}
                      onMouseLeave={e => { e.currentTarget.style.background = active ? `${color}2a` : `${color}1c`; e.currentTarget.style.borderColor = active ? color + 'cc' : color + '70' }}
                    >
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
                      {getTagLabel(tag.name)}
                      {mw != null && <span style={{ opacity: 0.55, fontSize: 10 }}>{mw}%</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Scrollable content area (desktop only; mobile scrolls via outer) ── */}
      <div style={!isMobile ? { flex: 1, overflowY: 'auto', overflowX: 'hidden' } : {}}>

      {/* ── Community Mode バナー ─────────────────────────────────────── */}
      {communityMode && (
        <div style={{
          margin: '14px 18px 0', padding: '10px 14px',
          background: UI.accentBg,
          border: `1px solid ${UI.accentBorder}`,
          borderRadius: 10,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1, color: UI.accent }}>◉</span>
          <div>
            <div style={{ fontSize: 11, color: UI.accent, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>
              Community Mode ON
            </div>
            <div style={{ fontSize: 11, color: UI.sub, lineHeight: 1.6 }}>
              タグに ↑↓ 投票したり、独自タグを追加できます。投票結果は「類似作品」の計算に反映されます。
            </div>
          </div>
        </div>
      )}

      {/* ── アクティブタグフィルターバナー ─────────────────────────────── */}
      {selectedTags.length > 0 && (
        <div style={{
          margin: '14px 18px 0', padding: '10px 14px',
          background: UI.accentBg,
          border: `1px solid ${UI.accentBorder}`,
          borderRadius: 10,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: UI.accent, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0, fontWeight: 600 }}>
            絞り込み中
          </span>
          {selectedTags.map(name => {
            const color = getTagColorVivid(name, theme)
            return (
              <span
                key={name}
                onClick={() => onTagClick(name)}
                title="クリックで解除"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                  padding: '3px 9px', borderRadius: 7,
                  background: `${color}20`, border: `1px solid ${color}70`, color,
                  cursor: 'pointer',
                }}
              >
                {name} <span style={{ opacity: 0.65, fontSize: 10 }}>✕</span>
              </span>
            )
          })}
          <button
            onClick={onClearTags}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: UI.muted, cursor: 'pointer', fontSize: 11, padding: '2px 4px',
              flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.color = UI.sub}
            onMouseLeave={e => e.currentTarget.style.color = UI.muted}
          >
            すべて解除
          </button>
        </div>
      )}

      {/* ── Synopsis + Community Translations ─────────────────────────── */}
      <SynopsisTranslation
        mangaId={manga.id}
        fallbackSynopsis={manga.synopsis}
        primaryColor={primaryColor}
        theme={theme}
        fontSize={14}
      />

      {/* ── マップ切替ボタン ─────────────────────────────────────────────── */}
      <div style={{ padding: '0 18px 18px' }}>
        {showSimilarMap ? (
          /* 2D表示中 → 3Dマップを開くボタン */
          <button
            onClick={onOpenSimilarMap}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 14,
              border: `1.5px solid ${UI.border}`,
              background: `linear-gradient(135deg, ${UI.accentBg} 0%, transparent 100%)`,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.accentBorder}`
              e.currentTarget.style.background = `linear-gradient(135deg, ${isDark ? 'rgba(129,140,248,0.18)' : 'rgba(109,106,248,0.10)'} 0%, transparent 100%)`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.border}`
              e.currentTarget.style.background = `linear-gradient(135deg, ${UI.accentBg} 0%, transparent 100%)`
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: UI.accentBg,
              border: `1px solid ${UI.accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: UI.accent,
            }}>◈</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: UI.text, marginBottom: 2 }}>
                3Dマップを開く
              </div>
              <div style={{ fontSize: 11, color: UI.muteLight }}>
                3Dビューで作品全体を探索
              </div>
            </div>
            <div style={{
              marginLeft: 'auto', flexShrink: 0,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              color: UI.accent,
              background: UI.accentBg,
              border: `1px solid ${UI.accentBorder}`,
              borderRadius: 6, padding: '4px 10px',
            }}>◈ 3D</div>
          </button>
        ) : (
          /* 3D表示中 → 2Dマップを開くボタン */
          <button
            onClick={onOpenSimilarMap}
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: 14,
              border: `1.5px solid ${UI.border}`,
              background: `linear-gradient(135deg, ${UI.accentBg} 0%, transparent 100%)`,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.accentBorder}`
              e.currentTarget.style.background = `linear-gradient(135deg, ${isDark ? 'rgba(129,140,248,0.18)' : 'rgba(109,106,248,0.10)'} 0%, transparent 100%)`
            }}
            onMouseLeave={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.border}`
              e.currentTarget.style.background = `linear-gradient(135deg, ${UI.accentBg} 0%, transparent 100%)`
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(196,48,48,0.06)',
              border: `1px solid ${isDark ? 'rgba(196,48,48,0.30)' : '#e8d0d0'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: isDark ? '#c48080' : '#e0a0a0',
            }}>⬡</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: UI.text, marginBottom: 2 }}>
                類似作品の2Dマップを開く
              </div>
              <div style={{ fontSize: 11, color: UI.muteLight }}>
                ノードを広げて類似作品を探索
              </div>
            </div>
            <div style={{
              marginLeft: 'auto', flexShrink: 0,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              color: UI.mapBadgeText,
              background: UI.mapBadgeBg,
              border: `1px solid ${UI.mapBadgeBorder}`,
              borderRadius: 6, padding: '4px 10px',
            }}>⬡ 2D</div>
          </button>
        )}
      </div>

      <div style={{ borderBottom: `1px solid ${UI.borderSoft}`, marginBottom: 0 }} />

      {/* ── Similar Works ──────────────────────────────────────────────── */}
      <div style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: UI.muteLight, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, flex: 1 }}>
            Similar Works
          </div>
          {onPopularityChange && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 1 }} title="注目度フィルター">
              {[1,2,3,4,5].map(n => {
                const active = n >= minPopularity
                const col = active ? POP_STAR_COLORS_DP[n] : (isDark ? '#374151' : '#d1d5db')
                return (
                  <button key={n}
                    onClick={() => onPopularityChange(n === minPopularity ? 1 : n)}
                    title={POP_LABELS_DP[n]}
                    style={{ background: 'none', border: 'none', padding: '1px 2px', cursor: 'pointer', fontSize: 14, color: col, lineHeight: 1, transition: 'color 0.12s' }}
                  >★</button>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {neighbors.map((neighbor, i) => {
            const reasons       = getSimilarityReasons(manga, neighbor)
            const neighborWeights = computeMapWeights(neighbor.tags || [], tagIdf)
            const nColor        = getTagColor(neighbor.tags?.[0]?.name || neighbor.genre)
            const simPct        = Math.max(15, 100 - (neighbor.distance || 0) * 110)

            return (
              <button
                key={neighbor.id}
                onClick={() => onSelect(neighbor)}
                style={{
                  background: UI.btnBg, border: `1px solid ${UI.borderSoft}`,
                  borderRadius: 14, padding: '14px',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex', gap: 14,
                  boxShadow: isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = nColor + '70'; e.currentTarget.style.background = nColor + '08' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = UI.borderSoft; e.currentTarget.style.background = UI.btnBg }}
              >
                {/* サムネイル */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <CoverImg manga={neighbor} width={70} height={98} borderRadius={8} />
                  <div style={{
                    position: 'absolute', top: -6, left: -6,
                    width: 22, height: 22, borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: UI.btnBg, border: `1.5px solid ${nColor}80`,
                    color: nColor,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                  }}>
                    {i + 1}
                  </div>
                </div>

                {/* 情報カラム */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 600, color: UI.textTitle,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {neighbor.title_ja || neighbor.title}
                  </div>

                  {reasons.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 10, color: UI.muteLight, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
                        共通タグ
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {reasons.slice(0, 5).map(t => {
                          const wA = mapWeights?.[t.name]
                          const wB = neighborWeights?.[t.name]
                          const sharedWeight = (wA != null && wB != null)
                            ? Math.round((wA + wB) / 2)
                            : null
                          return (
                            <TagBadge
                              key={t.name}
                              tag={{ name: t.name, rank: t.rank }}
                              active={selectedTags.includes(t.name)}
                              onClick={onTagClick}
                              size="sm"
                              mapWeight={sharedWeight}
                              theme={theme}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 類似度バー */}
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: UI.muteLight, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        similarity
                      </span>
                      <span style={{ fontSize: 12, color: nColor, fontWeight: 700 }}>
                        {simPct.toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 3, background: UI.trackBg, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3,
                        background: `linear-gradient(to right, ${nColor}cc, ${nColor}44)`,
                        width: `${simPct}%`,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
      {/* ── Community Tags ─────────────────────────────────────────────── */}
      {communityMode && (
        <CommunityTagSection
          mangaId={manga.id}
          theme={theme}
          onDataChange={onCommunityDataChange}
        />
      )}

      {/* ── Next Reads ─────────────────────────────────────────────────── */}
      <NextReadsSection
        mangaId={manga.id}
        allManga={allManga}
        onSelect={onSelect}
        onSelectSimilarMap={onSelectSimilarMap}
        primaryColor={primaryColor}
        authToken={authToken}
        currentUser={currentUser}
        theme={theme}
      />

      {/* ── Reviews ────────────────────────────────────────────────────── */}
      <ReviewSection
        mangaId={manga.id}
        primaryColor={primaryColor}
        authToken={authToken}
        currentUser={currentUser}
        theme={theme}
      />

      </div>{/* end scrollable content */}

    </div>
    </>
  )
}
