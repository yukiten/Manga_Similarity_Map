import { useState, useEffect } from 'react'
import { getTagColor } from '../utils'
import { getCoverUrl } from '../lib/imageSource'
import ReviewSection from './ReviewSection'
import NextReadsSection from './NextReadsSection'
import CommunityTagSection from './CommunityTagSection'

function getSimilarityReasons(manga, neighbor) {
  const aTagMap = new Map(manga.tags.map(t => [t.name, t]))
  return neighbor.tags
    .filter(t => !t.spoiler && aTagMap.has(t.name))
    .map(t => ({ ...t, rankSelf: aTagMap.get(t.name).rank }))
    .sort((a, b) => b.rank - a.rank)
}

function CoverImg({ manga, width, height, borderRadius = 8, style = {} }) {
  const url = getCoverUrl(manga)
  const color = getTagColor(manga.tags?.[0]?.name || manga.genre)
  if (!url) {
    return (
      <div style={{
        width, height, borderRadius, flexShrink: 0,
        background: `linear-gradient(160deg, ${color}40 0%, ${color}14 100%)`,
        border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        ...style,
      }}>
        <span style={{ fontSize: 28, opacity: 0.3 }}>📖</span>
      </div>
    )
  }
  return (
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
}

// タグバッジ：タグ名 + 数値 + 横バーの縦積みレイアウト
// mapWeight が渡された場合はアプリ独自の「マップ寄与度」を表示し、
// ラベルも "MAP WEIGHT" にする。渡されなければ AniList rank をそのまま表示。
function TagBadge({ tag, active, onClick, size = 'md', mapWeight }) {
  const color    = getTagColor(tag.name)
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
        background: active ? `${color}28` : `${color}14`,
        border: `1.5px solid ${active ? color + 'cc' : color + '55'}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s',
        boxShadow: active ? `0 1px 4px rgba(0,0,0,0.08)` : 'none',
        userSelect: 'none',
        minWidth: isSmall ? 56 : 72,
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.background = `${color}30`; e.currentTarget.style.borderColor = color + 'bb' } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.background = active ? `${color}28` : `${color}14`; e.currentTarget.style.borderColor = active ? color + 'cc' : color + '55' } }}
    >
      {/* タグ名 ＋ 数値 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
        <span style={{
          fontSize: isSmall ? 9 : 11, fontWeight: 700,
          color: active ? color : color + 'dd',
          textTransform: 'uppercase', letterSpacing: '0.07em',
          lineHeight: 1,
        }}>
          {active && '✓ '}{tag.name}
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

export default function DetailPanel({ manga, neighbors, tagIdf = {}, onClose, onSelect, onOpenSimilarMap, showSimilarMap, selectedTags = [], onTagClick, onClearTags, isFavorite = false, onToggleFavorite, isMobile = false, mapMode = false, neighborOnlyMode = false, onToggleNeighborMode, allManga = [], communityMode = false, onToggleCommunityMode, fullscreen = false, onToggleFullscreen, onGoToMap }) {
  const primaryColor = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const mapWeights   = computeMapWeights(manga.tags || [], tagIdf)
  const UI = {
    bg: '#faf9f5',
    surface: '#f8faff',
    border: '#e5e9f2',
    text: '#1f2937',
    sub: '#6b7280',
    muted: '#9aa1b2',
    accent: '#6d6af8',
    accentBg: 'rgba(109,106,248,0.10)',
    accentBorder: 'rgba(109,106,248,0.35)',
  }

  // マップ表示中は最初から最小化（マップを隠さないため）
  const [minimized, setMinimized] = useState(mapMode && isMobile)
  const [fsTab, setFsTab] = useState('synopsis')

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
    background: '#faf9f5',
    borderTop: `2px solid ${primaryColor}55`,
    borderRadius: '20px 20px 0 0',
    display: 'flex', flexDirection: 'column',
    overflowY: 'auto',
    animation: 'slideUp 0.25s ease',
    boxShadow: '0 -12px 40px rgba(15,23,42,0.12)',
  }
  const desktopStyle = {
    width: 500, height: '100%',
    background: '#faf9f5',
    borderLeft: '1px solid #e5e9f2',
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
        height: 128,
        background: 'rgba(250,249,245,0.97)',
        backdropFilter: 'blur(20px)',
        borderTop: `2px solid ${primaryColor}44`,
        borderRadius: '16px 16px 0 0',
        display: 'flex', alignItems: 'center',
        padding: '0 16px',
        gap: 14,
        boxShadow: '0 -4px 30px rgba(0,0,0,0.10)',
        animation: 'slideUp 0.2s ease',
      }}>
        {/* カバー */}
        <CoverImg manga={manga} width={72} height={100} borderRadius={8} />

        {/* 情報（タップで展開） */}
        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setMinimized(false)}>
          <div style={{ fontSize: 15, fontWeight: 700, color: UI.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
            {manga.title_ja || manga.title}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 6, alignItems: 'center' }}>
            {manga.score > 0 && (
              <span style={{ fontSize: 14, color: '#d97706', fontWeight: 700 }}>★ {(manga.score / 10).toFixed(1)}</span>
            )}
            {manga.year && (
              <span style={{ fontSize: 13, color: UI.sub }}>{manga.year}</span>
            )}
            {(manga.genre || manga.tags?.[0]?.name) && (
              <span style={{ fontSize: 12, color: primaryColor + 'cc', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {manga.genre || manga.tags?.[0]?.name}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: UI.muted, marginTop: 6 }}>タップで詳細を表示</div>
        </div>

        {/* ボタン列 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          {onOpenSimilarMap && (
            <button
              onClick={onOpenSimilarMap}
              title="類似作品マップを開く"
              style={{
                background: showSimilarMap ? UI.accentBg : UI.surface,
                border: `1px solid ${showSimilarMap ? UI.accentBorder : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                padding: '0 12px', height: 34, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 5,
                color: showSimilarMap ? UI.accent : UI.sub,
              }}
            >
              <span style={{ fontSize: 14 }}>⬡</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>類似</span>
            </button>
          )}
          {onToggleNeighborMode && (
            <button
              onClick={onToggleNeighborMode}
              title={neighborOnlyMode ? '全作品を表示' : '近傍のみ表示'}
              style={{
                background: neighborOnlyMode ? UI.accentBg : UI.surface,
                border: `1px solid ${neighborOnlyMode ? UI.accentBorder : UI.border}`,
                borderRadius: 8, cursor: 'pointer',
                padding: '0 12px', height: 34, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 5,
                color: neighborOnlyMode ? UI.accent : UI.sub,
              }}
            >
              <span style={{ fontSize: 14 }}>{neighborOnlyMode ? '★' : '☆'}</span>
              <span style={{ fontSize: 11, fontWeight: 600 }}>近傍</span>
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'rgba(240,238,234,0.8)', border: '1px solid #e0ddd8',
              borderRadius: 8, color: '#8a8880', cursor: 'pointer',
              height: 34, fontSize: 14, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 12px', gap: 4,
            }}
          >
            <span>＞</span>
            <span style={{ fontSize: 11 }}>閉じる</span>
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
        background: '#f5f4f0',
        animation: 'fadeUp 0.20s ease',
      }}>

        {/* ── 左パネル: カバーアート + 基本情報 ──────────────────────── */}
        <div style={{
          width: 300, flexShrink: 0,
          position: 'relative',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          borderRight: `1px solid #e8e6df`,
          background: '#faf9f5',
        }}>
          {/* 背景: ぼかしカバーアート */}
          {coverUrl && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <img src={coverUrl} alt="" style={{
                width: '100%', height: '100%',
                objectFit: 'cover',
                filter: 'blur(48px) saturate(1.2)',
                opacity: 0.08,
                transform: 'scale(1.12)',
              }} />
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(180deg, rgba(250,249,245,0.95) 0%, rgba(250,249,245,0.75) 40%, rgba(250,249,245,0.90) 70%, rgba(250,249,245,1) 100%)`,
              }} />
            </div>
          )}

          {/* ジャンルインジケーター */}
          <div style={{
            position: 'relative', zIndex: 1,
            padding: '14px 18px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderBottom: '1px solid #e8e6df',
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
              <div style={{ fontSize: 18, fontWeight: 800, color: '#1a1820', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                {manga.title_ja || manga.title}
              </div>
              {manga.title_ja && manga.title_ja !== manga.title && (
                <div style={{ fontSize: 11, color: '#b8b4b0', marginTop: 3, lineHeight: 1.4 }}>{manga.title}</div>
              )}
            </div>

            {/* スコア・年・リンク */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {manga.score > 0 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, fontWeight: 700, color: '#d97706', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.22)', borderRadius: 7, padding: '3px 9px' }}>
                  ★ {(manga.score / 10).toFixed(1)}
                </span>
              )}
              {manga.year && (
                <span style={{ fontSize: 12, color: '#8a8880', background: '#faf9f5', border: '1px solid #e8e6df', borderRadius: 7, padding: '3px 9px' }}>
                  {manga.year}
                </span>
              )}
              {manga.url && (
                <a href={manga.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#8a8880', textDecoration: 'none', border: '1px solid #e8e6df', borderRadius: 6, padding: '3px 8px', background: '#faf9f5', transition: 'color 0.15s, border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#c43030'; e.currentTarget.style.borderColor = '#e8d0d0' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#8a8880'; e.currentTarget.style.borderColor = '#e8e6df' }}
                >AniList ↗</a>
              )}
            </div>

            {/* アクションボタン */}
            <div style={{ display: 'flex', gap: 7, marginTop: 2 }}>
              {onToggleFavorite && (
                <button onClick={onToggleFavorite} style={{
                  flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                  background: isFavorite ? 'rgba(244,114,182,0.12)' : '#faf9f5',
                  border: `1px solid ${isFavorite ? '#f472b6' : '#e0ddd8'}`,
                  color: isFavorite ? '#f472b6' : '#8a8880', fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(244,114,182,0.18)'; e.currentTarget.style.borderColor = '#f472b6'; e.currentTarget.style.color = '#f472b6' }}
                onMouseLeave={e => { e.currentTarget.style.background = isFavorite ? 'rgba(244,114,182,0.12)' : '#faf9f5'; e.currentTarget.style.borderColor = isFavorite ? '#f472b6' : '#e0ddd8'; e.currentTarget.style.color = isFavorite ? '#f472b6' : '#8a8880' }}
                >{isFavorite ? '♥' : '♡'} {isFavorite ? 'お気に入り' : 'お気に入り'}</button>
              )}
              {onOpenSimilarMap && (
                <button onClick={onOpenSimilarMap} title="類似作品の2Dマップを開く" style={{
                  padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                  background: showSimilarMap ? 'rgba(196,48,48,0.10)' : '#faf9f5',
                  border: `1px solid ${showSimilarMap ? '#c43030' : '#e0ddd8'}`,
                  color: showSimilarMap ? '#c43030' : '#8a8880', fontSize: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.14)'; e.currentTarget.style.borderColor = '#c43030'; e.currentTarget.style.color = '#c43030' }}
                onMouseLeave={e => { e.currentTarget.style.background = showSimilarMap ? 'rgba(196,48,48,0.10)' : '#faf9f5'; e.currentTarget.style.borderColor = showSimilarMap ? '#c43030' : '#e0ddd8' }}
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
                    background: '#faf9f5', border: '1px solid #e0ddd8',
                    color: '#8a8880', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#c0bdb8'; e.currentTarget.style.color = '#1a1820' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0ddd8'; e.currentTarget.style.color = '#8a8880' }}
                >
                  <span style={{ fontSize: 14 }}>◈</span> 3Dマップ
                </button>
                <button
                  onClick={() => onGoToMap('2d')}
                  title="2D類似マップで探索"
                  style={{
                    flex: 1, padding: '8px 0', borderRadius: 9, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: 'rgba(196,48,48,0.06)', border: '1px solid #e8d0d0',
                    color: '#c43030', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.12)'; e.currentTarget.style.borderColor = '#c43030' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.06)'; e.currentTarget.style.borderColor = '#e8d0d0' }}
                >
                  <span style={{ fontSize: 14 }}>⬡</span> 2Dマップ
                </button>
              </div>
            )}

            {/* 絞り込みバナー */}
            {selectedTags.length > 0 && (
              <div style={{ padding: '8px 10px', background: 'rgba(196,48,48,0.06)', border: '1px solid rgba(196,48,48,0.20)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#c43030', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, flexShrink: 0 }}>絞り込み中</span>
                {selectedTags.map(name => {
                  const color = getTagColor(name)
                  return <span key={name} onClick={() => onTagClick(name)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '2px 7px', borderRadius: 6, background: `${color}28`, border: `1px solid ${color}80`, color, cursor: 'pointer' }}>{name} <span style={{ opacity: 0.6 }}>✕</span></span>
                })}
                <button onClick={onClearTags} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#c0bdb8', cursor: 'pointer', fontSize: 10 }} onMouseEnter={e => e.currentTarget.style.color = '#8a8880'} onMouseLeave={e => e.currentTarget.style.color = '#c0bdb8'}>解除</button>
              </div>
            )}
          </div>
        </div>

        {/* ── 中央パネル: あらすじ + レビュー ──────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e8e6df' }}>

          {/* トップバー: ボタン群 */}
          <div style={{
            flexShrink: 0, height: 48,
            borderBottom: '1px solid #e8e6df',
            display: 'flex', alignItems: 'center',
            padding: '0 18px', gap: 6,
          }}>
            {/* マップ遷移ボタン（左側） */}
            {onGoToMap && (
              <div style={{ display: 'flex', gap: 5, marginRight: 'auto' }}>
                <button
                  onClick={() => onGoToMap('3d')}
                  style={{ background: '#faf9f5', border: '1px solid #e0ddd8', borderRadius: 7, cursor: 'pointer', padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', gap: 5, color: '#8a8880', fontSize: 11, fontWeight: 600, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#c0bdb8'; e.currentTarget.style.color = '#1a1820' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0ddd8'; e.currentTarget.style.color = '#8a8880' }}
                ><span>◈</span> 3Dマップ</button>
                <button
                  onClick={() => onGoToMap('2d')}
                  style={{ background: 'rgba(196,48,48,0.06)', border: '1px solid #e8d0d0', borderRadius: 7, cursor: 'pointer', padding: '0 11px', height: 30, display: 'flex', alignItems: 'center', gap: 5, color: '#c43030', fontSize: 11, fontWeight: 600, transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.12)'; e.currentTarget.style.borderColor = '#c43030' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(196,48,48,0.06)'; e.currentTarget.style.borderColor = '#e8d0d0' }}
                ><span>⬡</span> 2Dマップ</button>
              </div>
            )}
            {onToggleCommunityMode && (
              <button onClick={onToggleCommunityMode} title={communityMode ? 'コミュニティモードをオフ' : 'コミュニティモードをオン'}
                style={{ background: communityMode ? 'rgba(196,48,48,0.10)' : '#faf9f5', border: `1px solid ${communityMode ? '#c43030' : '#e0ddd8'}`, borderRadius: 7, cursor: 'pointer', padding: '0 10px', height: 30, display: 'flex', alignItems: 'center', gap: 5, color: communityMode ? '#c43030' : '#8a8880', fontSize: 11, fontWeight: 700, transition: 'all 0.15s' }}>
                <span style={{ fontSize: 12 }}>{communityMode ? '◉' : '◎'}</span> Community
              </button>
            )}
            <button onClick={onToggleFullscreen} title="全画面を終了 (Esc)"
              style={{ background: '#faf9f5', border: '1px solid #e0ddd8', borderRadius: 7, color: '#8a8880', cursor: 'pointer', width: 30, height: 30, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#c43030'; e.currentTarget.style.color = '#c43030' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#e0ddd8'; e.currentTarget.style.color = '#8a8880' }}
            >⛶</button>
            <button onClick={onClose}
              style={{ background: '#faf9f5', border: '1px solid #e0ddd8', borderRadius: 7, color: '#8a8880', cursor: 'pointer', width: 30, height: 30, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f5f4f0'}
              onMouseLeave={e => e.currentTarget.style.background = '#faf9f5'}
            >✕</button>
          </div>

          {/* スクロールコンテンツ */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px 48px' }}>

            {/* あらすじ */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>
                Synopsis
              </div>
              <p style={{ fontSize: 15, color: '#5a5858', lineHeight: 1.9, margin: 0, whiteSpace: 'pre-wrap' }}>
                {manga.synopsis || '—'}
              </p>
            </div>

            <div style={{ borderBottom: '1px solid #e8e6df', marginBottom: 28 }} />

            {/* Community タグ */}
            {communityMode && (
              <>
                <CommunityTagSection mangaId={manga.id} defaultTags={manga.tags || []} primaryColor={primaryColor} />
                <div style={{ borderBottom: '1px solid #e8e6df', margin: '28px 0' }} />
              </>
            )}

            {/* レビュー（メインコンテンツ） */}
            <ReviewSection mangaId={manga.id} primaryColor={primaryColor} />

            {/* Next Reads */}
            <NextReadsSection mangaId={manga.id} allManga={allManga} onSelect={onSelect} primaryColor={primaryColor} />
          </div>
        </div>

        {/* ── 右パネル: タグランク + 類似作品 ─────────────────────────── */}
        <div style={{ width: 310, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#f5f4f0' }}>

          {/* トップバー（右、高さ合わせ） */}
          <div style={{ flexShrink: 0, height: 48, borderBottom: '1px solid #e8e6df' }} />

          {/* スクロールコンテンツ */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 18px 48px' }}>

            {/* タグランク評価 */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 14 }}>
                Tag Rankings
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {manga.tags.slice(0, 20).map(tag => {
                  const color = getTagColor(tag.name)
                  const mw = mapWeights?.[tag.name]
                  const displayVal = mw ?? tag.rank
                  const active = selectedTags.includes(tag.name)
                  return (
                    <div
                      key={tag.name}
                      onClick={() => onTagClick?.(tag.name)}
                      title={active ? 'クリックで解除' : 'クリックで絞り込む'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 10px', borderRadius: 8, cursor: onTagClick ? 'pointer' : 'default',
                        background: active ? `${color}18` : '#faf9f5',
                        border: `1px solid ${active ? color + '60' : '#e8e6df'}`,
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { if (onTagClick) { e.currentTarget.style.background = `${color}14`; e.currentTarget.style.borderColor = color + '55' } }}
                      onMouseLeave={e => { if (onTagClick) { e.currentTarget.style.background = active ? `${color}18` : '#faf9f5'; e.currentTarget.style.borderColor = active ? color + '60' : '#e8e6df' } }}
                    >
                      {/* タグ名 */}
                      <span style={{ flex: 1, fontSize: 11, fontWeight: active ? 700 : 500, color: active ? color : color + 'cc', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {active && '✓ '}{tag.name}
                      </span>
                      {/* パーセント値 */}
                      <span style={{ fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>{displayVal}%</span>
                      {/* バー */}
                      <div style={{ width: 48, height: 4, borderRadius: 3, background: '#f0ede8', flexShrink: 0, overflow: 'hidden' }}>
                        <div style={{ height: '100%', borderRadius: 3, width: `${displayVal}%`, background: `linear-gradient(to right, ${color}, ${color}66)` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ borderBottom: '1px solid #e8e6df', marginBottom: 20 }} />

            {/* 類似作品（コンパクト） */}
            <div>
              <div style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 12 }}>
                Similar Works
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
                        background: '#faf9f5', border: '1px solid #e8e6df',
                        borderRadius: 10, padding: '10px 12px',
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', gap: 10, alignItems: 'center',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = nColor + '70'; e.currentTarget.style.background = nColor + '08' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e6df'; e.currentTarget.style.background = '#faf9f5' }}
                    >
                      {/* 順位 */}
                      <span style={{ fontSize: 11, fontWeight: 700, color: nColor + '99', flexShrink: 0, width: 16, textAlign: 'right' }}>{i + 1}</span>
                      {/* サムネ */}
                      <CoverImg manga={neighbor} width={36} height={50} borderRadius={5} style={{ flexShrink: 0 }} />
                      {/* 情報 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1820', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
                          {neighbor.title_ja || neighbor.title}
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: '#f0ede8', overflow: 'hidden' }}>
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
            background: 'rgba(250,249,245,0.90)',
            border: '1px solid rgba(15,23,42,0.14)',
            boxShadow: '0 8px 18px rgba(15,23,42,0.14)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#1a1820',
            zIndex: 9999,
            backdropFilter: 'blur(14px) saturate(1.1)',
            WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
            transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
            pointerEvents: 'auto',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(240,238,232,0.96)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.20)'
            e.currentTarget.style.boxShadow = '0 10px 24px rgba(15,23,42,0.18)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(250,249,245,0.90)'
            e.currentTarget.style.borderColor = 'rgba(15,23,42,0.14)'
            e.currentTarget.style.boxShadow = '0 8px 18px rgba(15,23,42,0.14)'
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
          <div style={{ width: 44, height: 4, borderRadius: 2, background: '#d5dbea' }} />
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
                background: '#faf9f5', border: `1px solid ${UI.border}`,
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
                background: neighborOnlyMode ? UI.accentBg : '#faf9f5',
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
                background: communityMode ? UI.accentBg : '#faf9f5',
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
          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              title={isFavorite ? 'お気に入りから削除' : 'お気に入りに追加'}
              style={{
                background: isFavorite ? 'rgba(244,114,182,0.12)' : '#faf9f5',
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
                e.currentTarget.style.background = isFavorite ? 'rgba(244,114,182,0.12)' : '#faf9f5'
                e.currentTarget.style.borderColor = isFavorite ? '#f472b6' : UI.border
                e.currentTarget.style.color = isFavorite ? '#f472b6' : UI.sub
              }}
            >
              {isFavorite ? '♥' : '♡'}
            </button>
          )}
          {/* 全画面トグル（デスクトップのみ） */}
          {!isMobile && (
            <button
              onClick={onToggleFullscreen}
              title={fullscreen ? '全画面を終了 (Esc)' : '全画面表示'}
              style={{
                background: fullscreen ? UI.accentBg : '#faf9f5',
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
              background: '#faf9f5', border: `1px solid ${UI.border}`,
              borderRadius: 8, color: UI.sub, cursor: 'pointer',
              width: 34, height: 34, fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = UI.surface}
            onMouseLeave={e => e.currentTarget.style.background = '#faf9f5'}
          >✕</button>
        </div>

        {/* カバー＋情報 横並び */}
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', paddingRight: 40 }}>
          <CoverImg manga={manga} width={136} height={194} borderRadius={10} />

          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
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
                  fontSize: 13, fontWeight: 700, color: '#d97706',
                  background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.22)',
                  borderRadius: 8, padding: '3px 10px',
                }}>
                  ★ {(manga.score / 10).toFixed(1)}
                </span>
              )}
              {manga.year && (
                <span style={{
                  fontSize: 12, color: UI.sub,
                  background: '#faf9f5', border: `1px solid ${UI.border}`,
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

            {/* タグ（クリックで絞り込み） */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {manga.tags.slice(0, 10).map(tag => (
                <TagBadge
                  key={tag.name}
                  tag={tag}
                  active={selectedTags.includes(tag.name)}
                  onClick={onTagClick}
                  mapWeight={mapWeights?.[tag.name]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

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
            const color = getTagColor(name)
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

      {/* ── Synopsis ───────────────────────────────────────────────────── */}
      <div style={{ padding: '20px 22px' }}>
        <div style={{ fontSize: 11, color: UI.muted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
          Synopsis
        </div>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: 0 }}>
          {manga.synopsis || '—'}
        </p>
      </div>

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
              background: 'linear-gradient(135deg, rgba(109,106,248,0.06) 0%, rgba(109,106,248,0.02) 100%)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.accentBorder}`
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(109,106,248,0.10) 0%, rgba(109,106,248,0.05) 100%)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.border}`
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(109,106,248,0.06) 0%, rgba(109,106,248,0.02) 100%)'
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
              <div style={{ fontSize: 11, color: '#b8b4b0' }}>
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
              background: 'linear-gradient(135deg, rgba(109,106,248,0.06) 0%, rgba(109,106,248,0.02) 100%)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 14,
              transition: 'all 0.18s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.accentBorder}`
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(109,106,248,0.10) 0%, rgba(109,106,248,0.05) 100%)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.border = `1.5px solid ${UI.border}`
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(109,106,248,0.06) 0%, rgba(109,106,248,0.02) 100%)'
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: 'rgba(196,48,48,0.06)',
              border: '1px solid #e8d0d0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: '#e0a0a0',
            }}>⬡</div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1820', marginBottom: 2 }}>
                類似作品の2Dマップを開く
              </div>
              <div style={{ fontSize: 11, color: '#b8b4b0' }}>
                ノードを広げて類似作品を探索
              </div>
            </div>
            <div style={{
              marginLeft: 'auto', flexShrink: 0,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
              color: '#c0bdb8',
              background: 'rgba(0,0,0,0.04)',
              border: '1px solid #e0ddd8',
              borderRadius: 6, padding: '4px 10px',
            }}>⬡ 2D</div>
          </button>
        )}
      </div>

      <div style={{ borderBottom: '1px solid #e8e6df', marginBottom: 0 }} />

      {/* ── Similar Works ──────────────────────────────────────────────── */}
      <div style={{ padding: '20px 22px' }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#c0bdb8', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
            Similar Works
          </div>
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
                  background: '#faf9f5', border: '1px solid #e8e6df',
                  borderRadius: 14, padding: '14px',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'border-color 0.15s, background 0.15s',
                  display: 'flex', gap: 14,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = nColor + '70'; e.currentTarget.style.background = nColor + '08' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#e8e6df'; e.currentTarget.style.background = '#faf9f5' }}
              >
                {/* サムネイル */}
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <CoverImg manga={neighbor} width={70} height={98} borderRadius={8} />
                  <div style={{
                    position: 'absolute', top: -6, left: -6,
                    width: 22, height: 22, borderRadius: 6,
                    fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#faf9f5', border: `1.5px solid ${nColor}80`,
                    color: nColor,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
                  }}>
                    {i + 1}
                  </div>
                </div>

                {/* 情報カラム */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                  <div style={{
                    fontSize: 15, fontWeight: 600, color: '#1a1820',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {neighbor.title_ja || neighbor.title}
                  </div>

                  {reasons.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
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
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* 類似度バー */}
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: '#c0bdb8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        similarity
                      </span>
                      <span style={{ fontSize: 12, color: nColor, fontWeight: 700 }}>
                        {simPct.toFixed(0)}%
                      </span>
                    </div>
                    <div style={{ height: 4, borderRadius: 3, background: '#f0ede8', overflow: 'hidden' }}>
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
          defaultTags={manga.tags || []}
          primaryColor={primaryColor}
        />
      )}

      {/* ── Next Reads ─────────────────────────────────────────────────── */}
      <NextReadsSection
        mangaId={manga.id}
        allManga={allManga}
        onSelect={onSelect}
        primaryColor={primaryColor}
      />

      {/* ── Reviews ────────────────────────────────────────────────────── */}
      <ReviewSection
        mangaId={manga.id}
        primaryColor={primaryColor}
      />

    </div>
    </>
  )
}
