import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react'
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom'
const MangaMap3D = lazy(() => import('./components/MangaMap3D'))
import SearchBar, { fuzzyScore } from './components/SearchBar'
import DetailPanel from './components/DetailPanel'
import TagSelector from './components/TagSelector'
import SimilarityTreeMap from './components/SimilarityTreeMap'
import FavoritesMap from './components/FavoritesMap'
import AuthModal from './components/AuthModal'
import { getTagColor, getEffectivePop } from './utils'
import { getTagLabel } from './tagTranslations'
import { getCoverUrl } from './lib/imageSource'
import { updateSeoTags, setMangaJsonLd, setWebPageJsonLd, cleanupSeoTags } from './lib/seo'

// ── Neighbor computation ──────────────────────────────────────────────────────
function getNeighborsByTagCommunity(manga, tagIdf, tagIndex, communityData, count = 5) {
  const defaultVotes  = communityData?.default_tag_votes || {}
  const communityTags = (communityData?.community_tags  || [])
  const adjustedTags = (manga.tags || [])
    .filter(t => !t.spoiler)
    .map(t => {
      const v   = defaultVotes[t.name] || { upvotes: 0, downvotes: 0 }
      const net = v.upvotes - v.downvotes
      const mul = Math.max(0.1, Math.min(2.0, 1.0 + net * 0.15))
      return { ...t, rank: Math.round(t.rank * mul) }
    })
    .filter(t => t.rank > 5)

  // ケース非依存で tagIndex を検索できるように lowercase マップを作成
  const tagIndexLower = new Map(Object.keys(tagIndex).map(k => [k.toLowerCase(), k]))
  // 重複追加を防ぐため、補正後のタグ名セットを保持
  const existingNames = new Set(adjustedTags.map(t => t.name.toLowerCase()))

  for (const ct of communityTags) {
    const net = ct.upvotes - ct.downvotes
    if (net <= 0) continue
    // ケース非依存でデータセット内の正規タグ名を取得
    const canonical = tagIndexLower.get(ct.tag_name.toLowerCase())
    if (!canonical || existingNames.has(canonical.toLowerCase())) continue
    // strength(20-100) を基準ランクとし、追加投票(net-1)で±6ずつ調整。上限80
    const base = (ct.strength || 50) * 0.8
    adjustedTags.push({ name: canonical, rank: Math.min(80, Math.round(base + (net - 1) * 6)), spoiler: false })
  }
  return getNeighborsByTag({ ...manga, tags: adjustedTags }, tagIdf, tagIndex, count)
}

function getNeighborsByTag(manga, tagIdf, tagIndex, count = 5) {
  const srcTags = (manga.tags || []).filter(t => !t.spoiler)
  const vecA = {}
  let normA2 = 0
  for (const tag of srcTags) {
    const w = (tag.rank / 100) * (tagIdf[tag.name] || 1)
    vecA[tag.name] = w; normA2 += w * w
  }
  const normA = Math.sqrt(normA2)
  if (normA === 0) return []
  const candidateMap = new Map()
  for (const tag of srcTags) {
    for (const m of tagIndex[tag.name] || []) {
      if (m.id !== manga.id) candidateMap.set(m.id, m)
    }
  }
  const results = []
  for (const m of candidateMap.values()) {
    let dot = 0, normB2 = 0
    for (const tag of m.tags || []) {
      if (!tag.spoiler) {
        const w = (tag.rank / 100) * (tagIdf[tag.name] || 1)
        normB2 += w * w
        if (vecA[tag.name] != null) dot += vecA[tag.name] * w
      }
    }
    const sim = normA * Math.sqrt(normB2) > 0 ? dot / (normA * Math.sqrt(normB2)) : 0
    if (sim > 0) results.push({ ...m, distance: 1 - sim })
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, count)
}

function computeNeighborList(base, filteredData, tagIdf, tagIndex, limit, communityMode, communityData) {
  if (!base || filteredData.length === 0) return []
  const fetchCount = Math.max(limit * 3, 12)
  const idMap  = new Map(filteredData.map(m => [m.id, m]))
  const found  = new Set()
  const result = []
  for (const id of base.neighbors || []) {
    const m = idMap.get(id)
    if (m && !found.has(m.id)) { result.push(m); found.add(m.id) }
  }
  if (result.length < limit && Object.keys(tagIdf).length > 0 && Object.keys(tagIndex).length > 0) {
    const tagNeighbors = (communityMode && communityData)
      ? getNeighborsByTagCommunity(base, tagIdf, tagIndex, communityData, fetchCount)
      : getNeighborsByTag(base, tagIdf, tagIndex, fetchCount)
    for (const m of tagNeighbors) {
      if (!found.has(m.id)) { result.push(m); found.add(m.id) }
      if (result.length >= limit) break
    }
  }
  if (result.length < limit) {
    for (const m of getNeighbors3D(base, filteredData, fetchCount)) {
      if (!found.has(m.id)) { result.push(m); found.add(m.id) }
      if (result.length >= limit) break
    }
  }
  return result.slice(0, limit)
}

function getNeighbors3D(manga, allManga, count = 5) {
  return allManga
    .filter(m => m.id !== manga.id)
    .map(m => ({ ...m, distance: Math.sqrt((m.x - manga.x) ** 2 + (m.y - manga.y) ** 2 + (m.z - manga.z) ** 2) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
}

function useIsMobile() {
  const [v, setV] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const h = () => setV(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])
  return v
}

// setMetaTag は lib/seo.js の updateSeoTags に統合済み

// ── Sidebar nav genres (with colors) ─────────────────────────────────────────
const SIDEBAR_GENRES = [
  { label: 'アクション', tag: 'action' },
  { label: 'ロマンス',   tag: 'romance' },
  { label: 'ファンタジー', tag: 'fantasy' },
  { label: 'SF',        tag: 'sci-fi' },
  { label: 'ミステリー', tag: 'mystery' },
  { label: 'コメディ',  tag: 'comedy' },
  { label: 'スポーツ',  tag: 'sports' },
  { label: 'ホラー',    tag: 'horror' },
  { label: '歴史',      tag: 'historical' },
]

const POP_LABELS = ['', 'データなし', 'マイナー', '中堅人気', '人気作', '覇権']

// Popularity star colors: light mode needs higher contrast (especially ★4〜★5)
const POP_COLORS_LIGHT = ['', '#475569', '#334155', '#f59e0b', '#d97706', '#dc301a']
const POP_COLORS_DARK  = ['', '#444', '#6b7280', '#ffaa33', '#ffe066', '#fffbe6']

// ── Theme definitions ─────────────────────────────────────────────────────────
const THEMES = {
  light: {
    appBg:       '#f5f4f0',
    headerBg:    '#faf9f5',
    sidebarBg:   '#faf9f5',
    titleBarBg:  'rgba(250,249,245,0.94)',
    border:      '#d6dbe8',
    text:        '#0f172a',
    textSub:     '#334155',
    textMuted:   '#64748b',
    accent:      '#4f46e5',
    accentBg:    'rgba(79,70,229,0.14)',
    accentBorder:'rgba(79,70,229,0.45)',
    buttonBg:    '#faf9f5',
    buttonHover: '#f0eee8',
    starActive:  ['', '#64748b', '#94a3b8', '#fbbf24', '#f97316', '#d82929'],
    starDim:     '#64748b',
  },
  dark: {
    appBg:      '#0d1117',
    headerBg:   '#111827',
    sidebarBg:  '#111827',
    titleBarBg: 'rgba(13,17,23,0.97)',
    border:     '#1e2535',
    text:       '#e2e8f0',
    textSub:    '#9ca3af',
    textMuted:  '#6b7280',
    accent:     '#818cf8',
    accentBg:   'rgba(129,140,248,0.12)',
    accentBorder:'rgba(129,140,248,0.4)',
    buttonBg:   'rgba(255,255,255,0.04)',
    buttonHover:'rgba(255,255,255,0.08)',
    starActive: ['', '#374151', '#6b7280', '#fbbf24', '#f97316', '#ef4444'],
    starDim:    '#252535',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
export default function MapApp({ config, mediaType, mapBasePath }) {
  useEffect(() => {
    document.body.classList.add('map-mode')
    return () => document.body.classList.remove('map-mode')
  }, [])

  const isMobile = useIsMobile()
  const { slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isFullscreen = !!slug

  // Theme
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('manga-map-theme') || 'light' } catch { return 'light' }
  })
  const T = THEMES[theme]
  const POP_COLORS = theme === 'light' ? POP_COLORS_LIGHT : POP_COLORS_DARK
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    try { localStorage.setItem('manga-map-theme', next) } catch {}
  }

  const [mediaData, setMediaData]       = useState([])
  const [selected, setSelected]         = useState(null)
  const detailCache                     = useRef(new Map())
  const [focusTarget, setFocusTarget]   = useState(null)
  const [loading, setLoading]           = useState(true)
  const [minPopularity, setMinPopularity] = useState(1)
  const [tagIdf, setTagIdf]             = useState({})
  const [tagList, setTagList]           = useState([])
  const [selectedTags, setSelectedTags] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      const t = p.get('tags')
      return t ? t.split(',').map(decodeURIComponent).filter(Boolean) : []
    } catch { return [] }
  })
  const [tagFilterMode, setTagFilterMode] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search)
      return p.get('mode') === 'OR' ? 'OR' : 'AND'
    } catch { return 'AND' }
  })

  // タグ検索履歴
  const TAG_HISTORY_KEY = `${config.storageKey}-tag-history`
  const TAG_HISTORY_MAX = 12
  const [tagHistory, setTagHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`${config.storageKey}-tag-history`)) || [] } catch { return [] }
  })

  const favKey     = `${config.storageKey}-favorites`
  const viewedKey  = `${config.storageKey}-viewed`
  const [viewed, setViewed] = useState(() => {
    try { const s = localStorage.getItem(viewedKey); return s ? new Set(JSON.parse(s)) : new Set() } catch { return new Set() }
  })
  function addViewed(item) {
    setViewed(prev => {
      if (prev.has(item.id)) return prev
      const next = new Set(prev); next.add(item.id)
      try { localStorage.setItem(viewedKey, JSON.stringify([...next])) } catch {}
      return next
    })
    if (authToken) {
      fetch(`/api/user/viewed/${encodeURIComponent(item.id)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {})
    }
  }
  function toggleViewed(item) {
    const willAdd = !viewed.has(item.id)
    setViewed(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      try { localStorage.setItem(viewedKey, JSON.stringify([...next])) } catch {}
      return next
    })
    if (authToken) {
      const method = willAdd ? 'POST' : 'DELETE'
      fetch(`/api/user/viewed/${encodeURIComponent(item.id)}`, {
        method, headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {})
    }
  }
  function clearViewed() {
    setViewed(new Set())
    try { localStorage.removeItem(viewedKey) } catch {}
  }

  const [favorites, setFavorites] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const fav = params.get('fav')
      if (fav) {
        const ids = JSON.parse(atob(fav))
        localStorage.setItem(favKey, JSON.stringify(ids))
        return new Set(ids)
      }
      const saved = localStorage.getItem(favKey)
      return saved ? new Set(JSON.parse(saved)) : new Set()
    } catch { return new Set() }
  })
  const [showFavoritesMap, setShowFavoritesMap] = useState(false)

  // ── 認証 ──────────────────────────────────────────────────────────────────
  const AUTH_TOKEN_KEY = 'manga-map-auth-token'
  const AUTH_USER_KEY  = 'manga-map-auth-user'
  const [authToken, setAuthToken] = useState(() => {
    try { return localStorage.getItem(AUTH_TOKEN_KEY) || null } catch { return null }
  })
  const [currentUser, setCurrentUser] = useState(() => {
    try { return localStorage.getItem(AUTH_USER_KEY) || null } catch { return null }
  })
  const [showAuthModal, setShowAuthModal] = useState(false)

  // 起動時: トークンの有効性確認 + DB からデータ取得
  useEffect(() => {
    if (!authToken) return
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${authToken}` } })
      .then(r => {
        if (!r.ok) throw new Error('invalid')
        return r.json()
      })
      .then(data => {
        setCurrentUser(data.username)
        try { localStorage.setItem(AUTH_USER_KEY, data.username) } catch {}
        return Promise.all([
          fetch('/api/user/favorites', { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json()),
          fetch('/api/user/viewed',    { headers: { Authorization: `Bearer ${authToken}` } }).then(r => r.json()),
        ])
      })
      .then(([favData, viewedData]) => {
        setFavorites(new Set(favData.ids))
        setViewed(new Set(viewedData.ids))
        try {
          localStorage.setItem(favKey,    JSON.stringify(favData.ids))
          localStorage.setItem(viewedKey, JSON.stringify(viewedData.ids))
        } catch {}
      })
      .catch(() => {
        // トークン期限切れ → ログアウト状態に
        setAuthToken(null); setCurrentUser(null)
        try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.removeItem(AUTH_USER_KEY) } catch {}
      })
  }, [authToken]) // eslint-disable-line

  function handleAuthSuccess(token, username) {
    // ログイン成功 → ローカルのお気に入り・閲覧済みをDBに同期（和集合）
    try { localStorage.setItem(AUTH_TOKEN_KEY, token); localStorage.setItem(AUTH_USER_KEY, username) } catch {}
    setAuthToken(token); setCurrentUser(username); setShowAuthModal(false)
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    const localFavs    = [...favorites]
    const localViewed  = [...viewed]
    Promise.all([
      fetch('/api/user/favorites', { method: 'PUT', headers, body: JSON.stringify({ ids: localFavs }) }).then(r => r.json()),
      fetch('/api/user/viewed',    { method: 'PUT', headers, body: JSON.stringify({ ids: localViewed }) }).then(r => r.json()),
    ]).then(([favData, viewedData]) => {
      setFavorites(new Set(favData.ids))
      setViewed(new Set(viewedData.ids))
      try {
        localStorage.setItem(favKey,    JSON.stringify(favData.ids))
        localStorage.setItem(viewedKey, JSON.stringify(viewedData.ids))
      } catch {}
    }).catch(() => {})
  }

  function handleLogout() {
    if (authToken) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${authToken}` } }).catch(() => {})
    }
    setAuthToken(null); setCurrentUser(null)
    try { localStorage.removeItem(AUTH_TOKEN_KEY); localStorage.removeItem(AUTH_USER_KEY) } catch {}
  }

  function toggleFavorite(item) {
    const willAdd = !favorites.has(item.id)
    setFavorites(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else { next.add(item.id); addViewed(item) }
      try { localStorage.setItem(favKey, JSON.stringify([...next])) } catch {}
      return next
    })
    if (authToken) {
      const method = willAdd ? 'POST' : 'DELETE'
      fetch(`/api/user/favorites/${encodeURIComponent(item.id)}`, {
        method, headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {})
      if (willAdd) {
        fetch(`/api/user/viewed/${encodeURIComponent(item.id)}`, {
          method: 'POST', headers: { Authorization: `Bearer ${authToken}` },
        }).catch(() => {})
      }
    }
  }

  const [communityMode, setCommunityMode] = useState(false)
  const [communityData, setCommunityData] = useState(null)
  const [communityToast, setCommunityToast] = useState(false)
  const [hideViewedMode, setHideViewedMode] = useState(false)
  const [hideViewedToast, setHideViewedToast] = useState(false)
  const [neighborOnlyMode, setNeighborOnlyMode] = useState(false)
  const [neighborOnlyCount, setNeighborOnlyCount] = useState(10)
  const [mapLocked, setMapLocked]         = useState(false)
  const [lockedAnchor, setLockedAnchor]   = useState(null)
  const [history, setHistory]             = useState([])
  const [showSimilarMap, setShowSimilarMap] = useState(true)
  const [treeRootManga, setTreeRootManga]   = useState(null)
  const [sidebarOpen, setSidebarOpen]       = useState(true)



  useEffect(() => {
    if (isFullscreen && selected) {
      const title = selected.title_ja || selected.title
      updateSeoTags({
        title: `${title} — ${config.label}の類似作品 | Media Map`,
        description: `${title}の類似作品・おすすめ${config.label}をAIが分析。タグやジャンルで繋がる作品を探索できます。`,
        image: selected.cover || undefined,
        type: 'article',
      })
      setMangaJsonLd(selected)
    } else {
      updateSeoTags({
        title: `${config.label}マップ — Media Map`,
        description: `${config.label}の類似作品を探索できるインタラクティブマップ。AIが分析した作品の関連性を可視化。`,
      })
      setWebPageJsonLd({
        name: `${config.label}マップ — Media Map`,
        description: `${config.label}の類似作品を探索できるインタラクティブマップ`,
      })
    }
    return () => cleanupSeoTags()
  }, [isFullscreen, selected?.id, config.label]) // eslint-disable-line

  useEffect(() => {
    fetch(config.dataUrl)
      .then(r => r.json())
      .then(data => { setMediaData(data); setLoading(false) })
      .catch(err => { console.error('Failed to load data:', err); setLoading(false) })
  }, [config.dataUrl])

  useEffect(() => {
    const p = new URLSearchParams(location.search)
    const initSlug = p.get('slug')
    if (!initSlug || mediaData.length === 0) return
    const manga = mediaData.find(m => m.slug === initSlug)
    if (!manga) return
    navigate(location.pathname, { replace: true })
    setSelected(manga)
    setHistory([{ id: manga.id, title: manga.title, x: manga.x, y: manga.y, z: manga.z }])
    setFocusTarget({ x: manga.x, y: manga.y, z: manga.z, fitDistance: 11 })
    setTreeRootManga(manga)
    setShowSimilarMap(true)
    setShowFavoritesMap(false)
  }, [location.search, mediaData.length]) // eslint-disable-line

  useEffect(() => {
    if (!slug || mediaData.length === 0) return
    const manga = mediaData.find(m => m.slug === slug)
    if (manga && (!selected || selected.slug !== manga.slug)) {
      setSelected(manga)
      setTreeRootManga(manga)
      setShowSimilarMap(true)
      if (selected) setFocusTarget({ x: manga.x, y: manga.y, z: manga.z })
      else setFocusTarget({ x: manga.x, y: manga.y, z: manga.z, fitDistance: 11 })
    }
  }, [slug, mediaData, selected?.slug]) // eslint-disable-line

  useEffect(() => {
    if (isFullscreen && selected) navigate(`/${mediaType}/${selected.slug}`, { replace: true })
  }, [selected?.id]) // eslint-disable-line

  useEffect(() => {
    fetch(config.tagIdfUrl).then(r => r.json()).then(setTagIdf).catch(() => {})
    fetch(config.tagListUrl).then(r => r.json()).then(setTagList).catch(() => {})
  }, [config.tagIdfUrl, config.tagListUrl])

  // 作品選択時: あらすじ・楽天データをAPIから取得してマージ（キャッシュ付き）
  useEffect(() => {
    if (!selected || !config.detailUrl) return
    // すでに詳細データがある場合はスキップ
    if (selected.synopsis !== undefined || selected.synopsis_ja !== undefined) return
    const id = selected.id
    if (detailCache.current.has(id)) {
      const cached = detailCache.current.get(id)
      setSelected(prev => prev?.id === id ? { ...prev, ...cached } : prev)
      return
    }
    fetch(`${config.detailUrl}/${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(detail => {
        const extra = {
          synopsis:       detail.synopsis       ?? null,
          synopsis_ja:    detail.synopsis_ja    ?? null,
          affiliate_url:  detail.affiliate_url  ?? null,
          isbn:           detail.isbn           ?? null,
          author:         detail.author         ?? null,
          publisher:      detail.publisher      ?? null,
          sales_date:     detail.sales_date     ?? null,
          review_average: detail.review_average ?? null,
          review_count:   detail.review_count   ?? 0,
        }
        detailCache.current.set(id, extra)
        setSelected(prev => prev?.id === id ? { ...prev, ...extra } : prev)
      })
      .catch(() => {})
  }, [selected?.id]) // eslint-disable-line

  const filteredData = useMemo(
    () => mediaData.filter(m => getEffectivePop(m) >= minPopularity),
    [mediaData, minPopularity]
  )

  // タグ絞り込み済みデータ（タグ未選択時は filteredData と同一）
  const tagFilteredData = useMemo(() => {
    if (selectedTags.length === 0) return filteredData
    return filteredData.filter(m => {
      const tagNames = new Set((m.tags || []).filter(t => !t.spoiler).map(t => t.name))
      return tagFilterMode === 'AND'
        ? selectedTags.every(name => tagNames.has(name))
        : selectedTags.some(name => tagNames.has(name))
    })
  }, [filteredData, selectedTags, tagFilterMode])

  // 「閲覧済みを除外」モード時はネイバー候補から閲覧済み作品を除く（選択中の作品は常に含める）
  const candidateData = useMemo(() => {
    if (!hideViewedMode || viewed.size === 0) return tagFilteredData
    return tagFilteredData.filter(m => !viewed.has(m.id) || m.id === selected?.id)
  }, [tagFilteredData, hideViewedMode, viewed, selected?.id])

  // 人気作品パネル用: popularity>=4 からランダム20件（mediaData変更時のみ再シャッフル）
  const popularRandom = useMemo(() => {
    const pool = mediaData.filter(m => m.score > 0 && m.popularity >= 4)
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool.slice(0, 20)
  }, [mediaData])

  const tagIndex = useMemo(() => {
    const index = {}
    for (const item of candidateData) {
      for (const tag of item.tags || []) {
        if (!tag.spoiler) {
          if (!index[tag.name]) index[tag.name] = []
          index[tag.name].push(item)
        }
      }
    }
    return index
  }, [candidateData])

  const mapBaseSelected = lockedAnchor ?? selected

  const mapNeighbors = useMemo(() => {
    const limit = neighborOnlyMode ? neighborOnlyCount : 5
    return computeNeighborList(mapBaseSelected, candidateData, tagIdf, tagIndex, limit, communityMode, communityData)
  }, [mapBaseSelected, candidateData, tagIdf, tagIndex, neighborOnlyMode, neighborOnlyCount, communityMode, communityData])

  const neighbors = useMemo(() => {
    return computeNeighborList(selected, candidateData, tagIdf, tagIndex, 5, communityMode, communityData)
  }, [selected, candidateData, tagIdf, tagIndex, communityMode, communityData])

  useEffect(() => {
    if (!communityMode) { setCommunityToast(false); return }
    setCommunityToast(true)
    const t = setTimeout(() => setCommunityToast(false), 3000)
    return () => clearTimeout(t)
  }, [communityMode])

  useEffect(() => {
    if (!hideViewedMode) { setHideViewedToast(false); return }
    setHideViewedToast(true)
    const t = setTimeout(() => setHideViewedToast(false), 3000)
    return () => clearTimeout(t)
  }, [hideViewedMode])

  useEffect(() => {
    // lockedAnchor 中はそちらの communityData を取得（mapNeighbors の計算基準に合わせる）
    const targetId = lockedAnchor?.id ?? selected?.id
    if (!communityMode || !targetId) { setCommunityData(null); return }
    fetch(`/api/manga/${encodeURIComponent(targetId)}/community-tags`)
      .then(r => r.json())
      .then(setCommunityData)
      .catch(() => setCommunityData(null))
  }, [communityMode, lockedAnchor?.id, selected?.id]) // eslint-disable-line

  const displayData = useMemo(() => {
    if (neighborOnlyMode && mapBaseSelected && mapNeighbors.length > 0) {
      const ids = new Set([mapBaseSelected.id, ...mapNeighbors.map(n => n.id)])
      return tagFilteredData.filter(m => ids.has(m.id))
    }
    return tagFilteredData
  }, [neighborOnlyMode, mapBaseSelected, mapNeighbors, tagFilteredData])

  useEffect(() => {
    if (!neighborOnlyMode || !mapBaseSelected || mapNeighbors.length === 0) return
    if (mapLocked) return
    const nodes = [mapBaseSelected, ...mapNeighbors]
    const cx = nodes.reduce((s, m) => s + m.x, 0) / nodes.length
    const cy = nodes.reduce((s, m) => s + m.y, 0) / nodes.length
    const cz = nodes.reduce((s, m) => s + m.z, 0) / nodes.length
    const spread = Math.max(...nodes.map(m =>
      Math.sqrt((m.x - cx) ** 2 + (m.y - cy) ** 2 + (m.z - cz) ** 2)
    ))
    setFocusTarget({ x: cx, y: cy, z: cz, fitDistance: Math.max(spread * 2.4, 4) })
  }, [neighborOnlyMode, mapBaseSelected, mapNeighbors, mapLocked])

  const tagScores = useMemo(() => {
    if (selectedTags.length === 0 || Object.keys(tagIdf).length === 0) return null
    const scores = {}; let maxScore = 0
    for (const item of filteredData) {
      const tagNames = new Set((item.tags || []).filter(t => !t.spoiler).map(t => t.name))
      const matches = tagFilterMode === 'AND'
        ? selectedTags.every(name => tagNames.has(name))
        : selectedTags.some(name => tagNames.has(name))
      let score = 0
      if (matches) {
        for (const tag of item.tags || []) {
          if (!tag.spoiler && selectedTags.includes(tag.name))
            score += (tag.rank / 100) * (tagIdf[tag.name] || 1)
        }
      }
      scores[item.id] = score
      if (score > maxScore) maxScore = score
    }
    if (maxScore > 0) { for (const id in scores) scores[id] = scores[id] / maxScore }
    return scores
  }, [filteredData, selectedTags, tagIdf, tagFilterMode])

  const tagMatchCount = useMemo(() => {
    if (!tagScores) return 0
    return Object.values(tagScores).filter(s => s > 0).length
  }, [tagScores])

  const computeNeighbors = useCallback((item, count = 8) => {
    const idMap = new Map(candidateData.map(m => [m.id, m]))
    const found = new Set(); const result = []
    for (const id of item.neighbors || []) {
      const m = idMap.get(id)
      if (m && !found.has(m.id)) { result.push(m); found.add(m.id) }
    }
    if (result.length < count && Object.keys(tagIdf).length > 0 && Object.keys(tagIndex).length > 0) {
      for (const m of getNeighborsByTag(item, tagIdf, tagIndex, count * 3)) {
        if (!found.has(m.id)) { result.push(m); found.add(m.id) }
        if (result.length >= count) break
      }
    }
    if (result.length < count) {
      for (const m of getNeighbors3D(item, candidateData, count * 3)) {
        if (!found.has(m.id)) { result.push(m); found.add(m.id) }
        if (result.length >= count) break
      }
    }
    return result.slice(0, count)
  }, [candidateData, tagIdf, tagIndex])

  useEffect(() => {
    if (!neighborOnlyMode) { setMapLocked(false); setLockedAnchor(null) }
  }, [neighborOnlyMode])

  function handleEnterFullscreen() {
    if (selected) navigate(`/${mediaType}/${selected.slug}`)
  }
  function handleExitFullscreen() {
    navigate(mapBasePath || `/${mediaType}`)
  }
  function handleGoToMap(mode) {
    const idParam = selected ? `&slug=${selected.slug}` : ''
    navigate(`${mapBasePath || `/${mediaType}`}?mode=${mode}${idParam}`)
  }
  function handleSelect(item) {
    setSelected(item)
    if (!mapLocked) {
      if (selected) setFocusTarget({ x: item.x, y: item.y, z: item.z })
      else setFocusTarget({ x: item.x, y: item.y, z: item.z, fitDistance: 9 })
    }
    setHistory(prev => {
      if (prev.length > 0 && prev[prev.length - 1].id === item.id) return prev
      return [...prev, { id: item.id, title: item.title, x: item.x, y: item.y, z: item.z }].slice(-20)
    })
    // 2D表示中でルートが未設定の場合（3Dマップの点をクリック）はルートを設定
    if (showSimilarMap && !treeRootManga) {
      setTreeRootManga(item)
    }
  }
  function handleSimilarMapSearch(manga) {
    const found = filteredData.find(m => m.id === manga.id) || manga
    setTreeRootManga(found)
    setShowSimilarMap(true)
    setSelected(found)
    setHistory(prev => {
      if (prev.length > 0 && prev[prev.length - 1].id === found.id) return prev
      return [...prev, { id: found.id, title: found.title, x: found.x, y: found.y, z: found.z }].slice(-20)
    })
  }
  function handleOpenSimilarMap() {
    if (!selected) return
    if (showSimilarMap) { setShowSimilarMap(false) }
    else {
      setTreeRootManga(selected); setShowSimilarMap(true)
      if (showFavoritesMap) setShowFavoritesMap(false)
    }
  }
  function handleHistoryNav(item, sliceEnd) {
    const found = filteredData.find(m => m.id === item.id)
    if (!found) return
    setSelected(found)
    setFocusTarget({ x: found.x, y: found.y, z: found.z })
    setHistory(prev => prev.slice(0, sliceEnd))
  }
  function handleBack() {
    if (history.length < 2) return
    const prev = history[history.length - 2]
    handleHistoryNav(prev, history.length - 1)
  }
  function handleSearch(query) {
    if (!query) return
    const best = filteredData
      .map(m => ({ m, score: fuzzyScore(m, query) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)[0]?.m
    if (best) {
      if (showSimilarMap) handleSimilarMapSearch(best)
      else handleSelect(best)
    }
  }
  function handleToggleTag(name) {
    setSelectedTags(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  }

  // タグ状態をURLパラメータに同期（replace で履歴を汚さない）
  useEffect(() => {
    const p = new URLSearchParams(location.search)
    if (selectedTags.length > 0) {
      p.set('tags', selectedTags.map(encodeURIComponent).join(','))
      p.set('mode', tagFilterMode)
    } else {
      p.delete('tags')
      p.delete('mode')
    }
    const next = p.toString()
    const cur  = location.search.replace(/^\?/, '')
    if (next !== cur) {
      navigate({ search: next ? `?${next}` : '' }, { replace: true })
    }
  }, [selectedTags, tagFilterMode]) // eslint-disable-line

  // タグ組み合わせを履歴に保存（1.5秒デバウンス、1タグ以上かつ結果あり）
  useEffect(() => {
    if (selectedTags.length === 0) return
    const timer = setTimeout(() => {
      setTagHistory(prev => {
        const key = [...selectedTags].sort().join('\0')
        const deduped = prev.filter(h => [...h.tags].sort().join('\0') !== key)
        const next = [
          { tags: selectedTags, mode: tagFilterMode, ts: Date.now() },
          ...deduped,
        ].slice(0, TAG_HISTORY_MAX)
        try { localStorage.setItem(TAG_HISTORY_KEY, JSON.stringify(next)) } catch {}
        return next
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [selectedTags, tagFilterMode]) // eslint-disable-line

  function applyTagHistory(entry) {
    setSelectedTags(entry.tags)
    setTagFilterMode(entry.mode)
  }

  function removeTagHistory(key) {
    setTagHistory(prev => {
      const next = prev.filter(h => [...h.tags].sort().join('\0') !== key)
      try { localStorage.setItem(TAG_HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  function clearTagHistory() {
    setTagHistory([])
    try { localStorage.removeItem(TAG_HISTORY_KEY) } catch {}
  }

  // ── Active map view ──────────────────────────────────────────────────────────
  const activeView = showFavoritesMap ? 'favorites' : showSimilarMap ? 'similar' : '3d'

  // ── Layout ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    // モバイル: 2D類似マップをデフォルト表示。3Dはオプション
    const mobileView = showFavoritesMap ? 'favorites' : showSimilarMap ? 'similar' : '3d'

    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: T.appBg, overflow: 'hidden' }}>

        {/* ── トースト ── */}
        <CommunityToast visible={communityToast} theme={theme} />
        <HideViewedToast visible={hideViewedToast} count={viewed.size} theme={theme} />

        {/* ── Main content area ── */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

          {/* Loading */}
          {loading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, background: T.appBg }}>
              <div style={{ position: 'relative', width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2.5px solid ${T.accent}`, borderTopColor: 'transparent', animation: 'spinArc 1.4s linear infinite' }} />
                <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', border: `2px solid ${T.accent}44`, borderBottomColor: 'transparent', animation: 'spinArc 2s linear infinite reverse' }} />
                <span style={{ fontSize: 22, color: T.accent }}>◉</span>
              </div>
              <div style={{ fontSize: 14, color: T.textSub, letterSpacing: '0.06em' }}>{config.label}の世界を構築中…</div>
            </div>
          )}

          {/* 3D Map（オプション、明示的に選んだときのみ） */}
          {!loading && mobileView === '3d' && (
            <Suspense fallback={
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.appBg }}>
                <div style={{ position: 'relative', width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2.5px solid ${T.accent}`, borderTopColor: 'transparent', animation: 'spinArc 1.4s linear infinite' }} />
                  <span style={{ fontSize: 22, color: T.accent }}>◉</span>
                </div>
              </div>
            }>
              <MangaMap3D
                mangaData={displayData} selected={selected} neighbors={mapNeighbors}
                focusTarget={focusTarget} onSelect={handleSelect} tagScores={tagScores}
                neighborOnlyMode={false} mapLocked={false}
                actualSelected={selected} tagIdf={tagIdf} theme={theme}
              />
            </Suspense>
          )}

          {/* 2D 類似マップ（manga 選択済み） */}
          {!loading && mobileView === 'similar' && treeRootManga && (
            <SimilarityTreeMap
              rootManga={treeRootManga} computeNeighbors={computeNeighbors}
              onClose={() => setTreeRootManga(null)}
              onSelect={handleSelect}
              minPopularity={minPopularity} onPopularityChange={setMinPopularity}
              isMobile={true}
              onOpenFavorites={() => { setShowFavoritesMap(true); setShowSimilarMap(false) }}
              favoritesCount={favorites.size}
              mangaData={tagFilteredData}
              onRerootSearch={handleSimilarMapSearch}
              backLabel='← 戻る'
              theme={theme}
              tagScores={tagScores}
              mapHistory={history}
              onMapBack={handleBack}
              onMapHistoryNav={(item, sliceEnd) => handleHistoryNav(item, sliceEnd)}
              bottomOffset={selected ? 72 : 0}
              currentUser={currentUser}
              onLogin={() => setShowAuthModal(true)}
              onLogout={handleLogout}
              onToggleTheme={toggleTheme}
              communityMode={communityMode}
              onToggleCommunityMode={() => setCommunityMode(v => !v)}
              hideViewedMode={hideViewedMode}
              onToggleHideViewed={() => setHideViewedMode(v => !v)}
              viewedCount={viewed.size}
              tagList={tagList}
              selectedTags={selectedTags}
              onToggleTag={handleToggleTag}
              onClearTags={() => setSelectedTags([])}
              tagMatchCount={tagMatchCount}
              tagTotalCount={filteredData.length}
              tagFilterMode={tagFilterMode}
              onTagFilterModeChange={setTagFilterMode}
            />
          )}

          {/* 2D 類似マップ 空状態（manga 未選択）— 人気作品ディスカバリー */}
          {!loading && mobileView === 'similar' && !treeRootManga && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                {/* 上部: 促しメッセージ */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '80px 32px 0' }}>
                  <div style={{ fontSize: 40, opacity: 0.10, color: T.text, lineHeight: 1 }}>◉</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>作品を検索してください</div>
                  <div style={{ fontSize: 12, color: T.textSub, textAlign: 'center', lineHeight: 1.7 }}>
                    上の検索バーでタイトルを入力するか<br />下の作品をタップして探索を開始
                  </div>
                </div>

                {/* 下部: DetailPanel風の人気作品パネル */}
                {popularRandom.length > 0 && (
                  <div style={{
                    position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 70,
                    background: theme === 'dark' ? 'rgba(17,24,39,0.92)' : 'rgba(250,249,245,0.94)',
                    backdropFilter: 'blur(20px)',
                    borderTop: `2px solid ${T.accent}44`,
                    borderRadius: '16px 16px 0 0',
                    padding: '14px 0 env(safe-area-inset-bottom, 14px)',
                    boxShadow: '0 -4px 30px rgba(0,0,0,0.10)',
                    animation: 'slideUp 0.25s ease',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', marginBottom: 10 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>人気作品</div>
                      <div style={{ fontSize: 11, color: T.textMuted }}>タップで類似作品を探索</div>
                    </div>
                    <div style={{
                      display: 'flex', gap: 10, overflowX: 'auto', padding: '0 16px',
                      scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
                      touchAction: 'pan-x',
                    }}
                      onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}
                    >
                      {popularRandom.map(manga => {
                        const coverUrl = getCoverUrl(manga)
                        const color = getTagColor(manga.tags?.[0]?.name || manga.genre)
                        return (
                          <button key={manga.id}
                            onClick={() => { handleSimilarMapSearch(manga); setShowSimilarMap(true); setShowFavoritesMap(false) }}
                            style={{
                              flexShrink: 0, width: 90, scrollSnapAlign: 'start',
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: 0, textAlign: 'center',
                            }}
                          >
                            {coverUrl ? (
                              <img src={coverUrl} alt={manga.title_ja || manga.title}
                                style={{ width: 72, height: 100, objectFit: 'cover', borderRadius: 8, border: `1px solid ${color}40`, boxShadow: `0 4px 12px rgba(0,0,0,0.20)` }}
                                loading="lazy"
                              />
                            ) : (
                              <div style={{ width: 72, height: 100, borderRadius: 8, background: `${color}22`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                <span style={{ fontSize: 20, opacity: 0.3 }}>📖</span>
                              </div>
                            )}
                            <div style={{ fontSize: 11, fontWeight: 600, color: T.text, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3 }}>
                              {manga.title_ja || manga.title}
                            </div>
                            {manga.score > 0 && (
                              <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>★ {(manga.score / 10).toFixed(1)}</div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
          )}

          {/* お気に入りマップ */}
          {!loading && mobileView === 'favorites' && (
            <FavoritesMap
              mangaData={mediaData} favorites={favorites}
              viewed={viewed} onClearViewed={clearViewed}
              onClose={() => { setShowFavoritesMap(false); setShowSimilarMap(true) }}
              onSelect={handleSelect} isMobile={true} theme={theme}
            />
          )}

          {/* 3D 操作ヒント */}
          {!loading && mobileView === '3d' && (
            <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', background: theme === 'dark' ? 'rgba(13,17,23,0.90)' : 'rgba(250,249,245,0.88)', border: `1px solid ${T.border}`, borderRadius: 10, padding: '7px 14px', fontSize: 11, color: T.textSub, pointerEvents: 'none', display: 'flex', gap: 12, whiteSpace: 'nowrap', backdropFilter: 'blur(14px)' }}>
              {[['1本指', '視点移動'], ['2本指', 'ズーム'], ['タップ', '選択']].map(([k, v]) => (
                <span key={k}><span style={{ color: T.accent, fontWeight: 600 }}>{k}</span> {v}</span>
              ))}
            </div>
          )}

          {/* Auth modal */}
          {showAuthModal && <AuthModal onSuccess={handleAuthSuccess} onClose={() => setShowAuthModal(false)} theme={theme} />}

          {/* ── Top overlay: 検索バー（2D類似マップ表示中は非表示 = SimilarityTreeMap内に内蔵） ── */}
          {mobileView === 'similar' && !treeRootManga ? (
          /* ── 未選択時: SimilarityTreeMap風 2行ヘッダー ── */
          <div style={{ position: 'absolute', zIndex: 10, top: 0, left: 0, right: 0, display: 'flex', flexDirection: 'column', borderBottom: `1px solid ${theme === 'light' ? '#e5e9f2' : '#1e2535'}`, background: theme === 'dark' ? 'rgba(17,24,39,0.97)' : 'rgba(250,249,245,0.97)', backdropFilter: 'blur(16px)' }}>
            {/* 1行目: ← 戻る + 検索バー（コンパクト） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px' }}>
              <button onClick={() => { setShowSimilarMap(false); setShowFavoritesMap(false) }}
                aria-label="3Dマップに切り替え"
                style={{ background: theme === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)', border: `1px solid ${theme === 'light' ? '#e5e9f2' : '#1e2535'}`, borderRadius: 6, color: theme === 'light' ? '#6b7280' : '#9ca3af', cursor: 'pointer', padding: '4px 8px', fontSize: 14, fontWeight: 600, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >←</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SearchBar
                  mangaData={mediaData}
                  onSearch={handleSearch}
                  onSelect={item => { handleSimilarMapSearch(item); setShowSimilarMap(true); setShowFavoritesMap(false) }}
                  variant={theme === 'dark' ? 'dark' : 'light'}
                  compact
                />
              </div>
            </div>
            {/* 2行目: ユーティリティボタン */}
            {(() => {
              const isL = theme === 'light'
              const hBdr = isL ? '#e5e9f2' : '#1e2535'
              const tSub = isL ? '#6b7280' : '#9ca3af'
              const acc  = isL ? '#6d6af8' : '#818cf8'
              const uAccBg = isL ? 'rgba(109,106,248,0.08)' : 'rgba(129,140,248,0.10)'
              const uBtnBg = isL ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
              const uBtn = { background: uBtnBg, border: `1px solid ${hBdr}`, borderRadius: 6, color: tSub, cursor: 'pointer', padding: '3px 6px', fontSize: 10, fontWeight: 600, flexShrink: 0, transition: 'all 0.12s' }
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px 5px' }}>
                  {/* 既読除外 */}
                  {viewed.size > 0 && (
                    <button onClick={() => setHideViewedMode(v => !v)}
                      aria-label={hideViewedMode ? '既読除外を解除' : '既読作品を除外'}
                      aria-pressed={hideViewedMode}
                      style={{ ...uBtn, background: hideViewedMode ? uAccBg : uBtn.background, borderColor: hideViewedMode ? `${acc}55` : hBdr, color: hideViewedMode ? acc : tSub }}
                    >{hideViewedMode ? `👁${viewed.size}` : '👁'}</button>
                  )}
                  {/* コミュニティ */}
                  <button onClick={() => setCommunityMode(v => !v)}
                    aria-label={communityMode ? 'コミュニティモードを無効にする' : 'コミュニティモードを有効にする'}
                    aria-pressed={communityMode}
                    style={{ ...uBtn, background: communityMode ? uAccBg : uBtn.background, borderColor: communityMode ? `${acc}55` : hBdr, color: communityMode ? acc : tSub }}
                  >{communityMode ? '◉COM' : '◎COM'}</button>
                  <div style={{ flex: 1 }} />
                  {/* お気に入り */}
                  <button onClick={() => { setShowFavoritesMap(true); setShowSimilarMap(false) }}
                    aria-label={`お気に入り${favorites.length > 0 ? ` (${favorites.length})` : ''}`}
                    style={{ ...uBtn, fontSize: 10, color: '#f472b6', borderColor: '#f472b644' }}
                  >{favorites.length > 0 ? `♥${favorites.length}` : '♥'}</button>
                  {/* テーマ */}
                  <button onClick={toggleTheme}
                    aria-label={theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
                    style={{ ...uBtn, fontSize: 11 }}
                  >{theme === 'light' ? '🌙' : '☀️'}</button>
                  {/* ログイン */}
                  {currentUser ? (
                    <a href={`/user/${currentUser}`} title="マイページを見る"
                      style={{ ...uBtn, fontSize: 10, fontWeight: 700, background: uAccBg, borderColor: `${acc}55`, color: acc, textDecoration: 'none' }}
                    >◉{currentUser.slice(0, 4)}</a>
                  ) : (
                    <button onClick={() => setShowAuthModal(true)}
                      style={{ ...uBtn, fontSize: 10, fontWeight: 700, background: uAccBg, borderColor: `${acc}55`, color: acc }}
                    >ログイン</button>
                  )}
                </div>
              )
            })()}

            {/* タグセレクター */}
            <div style={{ padding: '0 8px 5px' }}>
              <TagSelector tagList={tagList} selectedTags={selectedTags} onToggleTag={handleToggleTag} onClearTags={() => setSelectedTags([])} matchCount={tagMatchCount} totalCount={filteredData.length} variant={theme === 'dark' ? 'dark' : 'light'} filterMode={tagFilterMode} onFilterModeChange={setTagFilterMode} />
            </div>

            {/* タグ絞込結果から2D探索（モバイル） */}
            {selectedTags.length > 0 && tagFilteredData.length > 0 && (() => {
              const topItems = [...tagFilteredData]
                .sort((a, b) => (tagScores?.[b.id] ?? 0) - (tagScores?.[a.id] ?? 0))
                .slice(0, 5)
              return (
                <div style={{ padding: '8px 12px 10px', background: T.accentBg, borderBottom: `1px solid ${T.accentBorder}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 6 }}>
                    ◉ 2Dマップで探索
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {topItems.map(manga => (
                      <button key={manga.id}
                        onClick={() => { handleSimilarMapSearch(manga); setShowSimilarMap(true); setShowFavoritesMap(false) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.buttonBg, cursor: 'pointer', textAlign: 'left', width: '100%' }}
                      >
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: getTagColor(manga.tags?.[0]?.name) }} />
                        <div style={{ flex: 1, fontSize: 13, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {manga.title_ja || manga.title}
                        </div>
                        <span style={{ fontSize: 12, color: T.accent, flexShrink: 0 }}>→</span>
                      </button>
                    ))}
                    {tagFilteredData.length > 5 && (
                      <div style={{ fontSize: 10, color: T.accent, textAlign: 'center', opacity: 0.7 }}>
                        他 {(tagFilteredData.length - 5).toLocaleString()} 件
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* タグ検索履歴（モバイル） */}
            {tagHistory.length > 0 && (
              <div style={{ padding: '8px 12px 10px', borderBottom: `1px solid ${T.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.10em', textTransform: 'uppercase' }}>タグ履歴</div>
                  <button onClick={clearTagHistory} style={{ fontSize: 10, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}>すべて削除</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {tagHistory.slice(0, 6).map(entry => {
                    const key = [...entry.tags].sort().join('\0')
                    const isActive = [...selectedTags].sort().join('\0') === key
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={() => applyTagHistory(entry)}
                          style={{
                            flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
                            padding: '6px 8px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                            border: `1px solid ${isActive ? T.accentBorder : T.border}`,
                            background: isActive ? T.accentBg : T.buttonBg,
                          }}
                        >
                          <span style={{ fontSize: 9, color: isActive ? T.accent : T.textMuted, fontWeight: 700, marginRight: 2 }}>
                            {entry.mode}
                          </span>
                          {entry.tags.map(t => (
                            <span key={t} style={{
                              fontSize: 11, padding: '1px 6px', borderRadius: 4,
                              background: `${getTagColor(t)}22`,
                              color: getTagColor(t),
                              border: `1px solid ${getTagColor(t)}44`,
                              whiteSpace: 'nowrap',
                            }}>
                              {getTagLabel(t)}
                            </span>
                          ))}
                        </button>
                        <button onClick={() => removeTagHistory(key)}
                          aria-label="このタグ履歴を削除"
                          style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: '2px 4px', lineHeight: 1, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

          </div>
          ) : mobileView !== 'similar' ? (
          /* ── 3D/その他モード: 従来の1行ヘッダー ── */
          <div style={{ position: 'absolute', zIndex: 10, top: 12, left: 12, right: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>

            {/* 検索行 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SearchBar
                  mangaData={mediaData}
                  onSearch={handleSearch}
                  onSelect={item => { handleSimilarMapSearch(item); setShowSimilarMap(true); setShowFavoritesMap(false) }}
                  variant={theme === 'dark' ? 'dark' : 'light'}
                />
              </div>
              {/* 3D アクセスボタン（控えめ） */}
              {mobileView !== '3d' ? (
                <button
                  onClick={() => { setShowSimilarMap(false); setShowFavoritesMap(false) }}
                  aria-label="3Dマップに切り替え"
                  style={{ flexShrink: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.buttonBg, color: T.textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(12px)', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="3Dマップ（実験的）"
                >3D</button>
              ) : (
                <button
                  onClick={() => { setShowSimilarMap(true); setShowFavoritesMap(false) }}
                  aria-label="2Dマップに切り替え"
                  style={{ flexShrink: 0, padding: '7px 9px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentBg, color: T.accent, fontSize: 10, fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(12px)', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >◉ 2D</button>
              )}
              {/* テーマ切替 */}
              <button
                onClick={toggleTheme}
                aria-label={theme === 'light' ? 'ダークモードに切り替え' : 'ライトモードに切り替え'}
                title={theme === 'light' ? 'ダークモード' : 'ライトモード'}
                style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 8, border: `1px solid ${T.border}`, background: T.buttonBg, color: T.textSub, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(12px)' }}
              >{theme === 'light' ? '🌙' : '☀️'}</button>
              {/* ログイン */}
              {currentUser ? (
                <a href={`/user/${currentUser}`}
                  aria-label="マイページを見る"
                  style={{ flexShrink: 0, padding: '7px 10px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentBg, color: T.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', backdropFilter: 'blur(12px)', textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
                  title="マイページを見る"
                >◉ {currentUser.slice(0, 6)}</a>
              ) : (
                <button onClick={() => setShowAuthModal(true)}
                  aria-label="ログイン"
                  style={{ flexShrink: 0, padding: '7px 10px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentBg, color: T.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', backdropFilter: 'blur(12px)', minHeight: 44 }}
                >ログイン</button>
              )}
            </div>

            {/* タグセレクター */}
            <TagSelector tagList={tagList} selectedTags={selectedTags} onToggleTag={handleToggleTag} onClearTags={() => setSelectedTags([])} matchCount={tagMatchCount} totalCount={filteredData.length} variant={theme === 'dark' ? 'dark' : 'light'} filterMode={tagFilterMode} onFilterModeChange={setTagFilterMode} />

          </div>
          ) : null}{/* end Top overlay conditional */}

          {/* ── 右下コントロール（既読除外・Community）── 未選択2Dマップではヘッダーに統合済み */}
          {mobileView !== 'favorites' && !(mobileView === 'similar') && (
            <div style={{
              position: 'absolute', right: 12, bottom: selected ? 72 + 12 : (mobileView === 'similar' && !treeRootManga && mediaData.length > 0) ? 180 : 16,
              zIndex: 12,
              display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end',
              transition: 'bottom 0.2s ease',
            }}>
              {/* 既読除外 */}
              {viewed.size > 0 && (
                <button onClick={() => setHideViewedMode(v => !v)}
                  aria-label={hideViewedMode ? '既読除外を解除' : '既読作品を除外'}
                  aria-pressed={hideViewedMode}
                  style={{ padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700, background: hideViewedMode ? T.accentBg : T.buttonBg, border: `1px solid ${hideViewedMode ? T.accentBorder : T.border}`, color: hideViewedMode ? T.accent : T.textSub, backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', minHeight: 44 }}
                ><span aria-hidden="true">👁</span>{hideViewedMode ? `除外(${viewed.size})` : '既読除外'}</button>
              )}
              {/* Community */}
              <button onClick={() => setCommunityMode(v => !v)}
                aria-label={communityMode ? 'コミュニティモードを無効にする' : 'コミュニティモードを有効にする'}
                aria-pressed={communityMode}
                style={{ padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700, background: communityMode ? T.accentBg : T.buttonBg, border: `1px solid ${communityMode ? T.accentBorder : T.border}`, color: communityMode ? T.accent : T.textSub, backdropFilter: 'blur(14px)', display: 'flex', alignItems: 'center', gap: 4, minHeight: 44 }}
              ><span aria-hidden="true">{communityMode ? '◉' : '◎'}</span>Community</button>
            </div>
          )}

        </div>

        {/* ── 作品遷移履歴バー（類似マップ以外で表示、ミニバーの上に配置） ── */}
        {history.length > 1 && !(mobileView === 'similar' && treeRootManga) && mobileView !== 'favorites' && (
          <div style={{
            position: selected ? 'fixed' : 'relative',
            bottom: selected ? 72 : undefined,
            left: selected ? 0 : undefined,
            right: selected ? 0 : undefined,
            zIndex: selected ? 71 : undefined,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px',
            background: theme === 'dark' ? 'rgba(13,17,23,0.96)' : 'rgba(250,249,245,0.96)',
            borderTop: `1px solid ${T.border}`,
            backdropFilter: selected ? 'blur(18px)' : undefined,
            boxShadow: selected ? (theme === 'dark' ? '0 -2px 12px rgba(0,0,0,0.4)' : '0 -2px 12px rgba(0,0,0,0.08)') : undefined,
            paddingBottom: selected ? undefined : 'env(safe-area-inset-bottom, 0px)',
          }}>
            <button onClick={handleBack}
              aria-label="前の作品に戻る"
              style={{ flexShrink: 0, padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentBg, color: T.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', minHeight: 44 }}
            >← 戻る</button>
            <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', display: 'flex', gap: 5, touchAction: 'pan-x' }}
              onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}
            >
              {history.slice(0, -1).map((item, i, arr) => {
                const isLatest = i === arr.length - 1
                const histIdx = history.findIndex(h => h.id === item.id)
                return (
                  <button key={`${item.id}-${i}`} onClick={() => handleHistoryNav(item, histIdx + 1)}
                    style={{
                      flexShrink: 0, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                      fontSize: 11, whiteSpace: 'nowrap', fontWeight: isLatest ? 600 : 400,
                      background: isLatest ? T.accentBg : T.buttonBg,
                      border: `1px solid ${isLatest ? T.accentBorder : T.border}`,
                      color: isLatest ? T.accent : T.textSub,
                    }}
                  >{item.title}</button>
                )
              })}
            </div>
          </div>
        )}

        {/* DetailPanel */}
        {selected && (
          <DetailPanel
            manga={selected} neighbors={neighbors} tagIdf={tagIdf}
            onClose={isFullscreen ? handleExitFullscreen : () => setSelected(null)}
            mapMode={true} onSelect={handleSelect} onSelectSimilarMap={handleSimilarMapSearch}
            onOpenSimilarMap={handleOpenSimilarMap} showSimilarMap={showSimilarMap}
            selectedTags={selectedTags} onTagClick={handleToggleTag} onClearTags={() => setSelectedTags([])}
            isFavorite={favorites.has(selected.id)} onToggleFavorite={() => toggleFavorite(selected)}
            isMobile={true} neighborOnlyMode={false}
            allManga={tagFilteredData} communityMode={communityMode}
            onToggleCommunityMode={() => setCommunityMode(v => !v)}
            fullscreen={isFullscreen}
            onToggleFullscreen={isFullscreen ? handleExitFullscreen : handleEnterFullscreen}
            onGoToMap={isFullscreen ? handleGoToMap : undefined}
            minPopularity={minPopularity} onPopularityChange={setMinPopularity}
            isViewed={viewed.has(selected.id)} onToggleViewed={() => toggleViewed(selected)}
            theme={theme}
            onCommunityDataChange={setCommunityData}
            communityData={communityData}
            authToken={authToken} currentUser={currentUser}
          />
        )}
      </div>
    )
  }

  // ── Desktop layout ──────────────────────────────────────────────────────────
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: T.appBg, overflow: 'hidden' }}>

      {/* ── コミュニティモード トースト ── */}
      <CommunityToast visible={communityToast} theme={theme} />

      {/* ── Top Header ───────────────────────────────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '0 16px', height: 56,
        background: T.headerBg,
        borderBottom: `1px solid ${T.border}`,
        zIndex: 100,
        position: 'relative',
        overflow: 'visible',
        boxShadow: theme === 'light' ? '0 2px 10px rgba(15,23,42,0.06)' : 'none',
      }}>
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, minWidth: 0 }}>
          {/* Sidebar toggle */}
          <button onClick={() => setSidebarOpen(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: '4px 6px', borderRadius: 6, lineHeight: 1, flexShrink: 0, transition: 'color 0.15s' }}
            title={sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'}
            onMouseEnter={e => e.currentTarget.style.color = T.text}
            onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
          >☰</button>

          {/* Logo */}
          <Link to={`/${mediaType}`} style={{ display: 'flex', alignItems: 'center', gap: 7, textDecoration: 'none', flexShrink: 0 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg,#7c6ff0,#9c6bff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 900, color: '#fff',
              boxShadow: '0 4px 10px rgba(124,111,240,0.28)',
            }}>M</div>
            <span style={{ fontSize: 12, fontWeight: 800, color: T.text, letterSpacing: '0.10em', whiteSpace: 'nowrap' }}>MANGA MAP</span>
          </Link>
        </div>

        {/* Center */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'center', padding: '0 14px' }}>
          <div style={{ width: 'min(720px, 100%)' }}>
            <SearchBar mangaData={mediaData} onSearch={handleSearch} onSelect={item => showSimilarMap ? handleSimilarMapSearch(item) : handleSelect(item)} variant={theme === 'dark' ? 'dark' : 'light'} />
          </div>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button
            onClick={toggleTheme}
            title={theme === 'light' ? 'ダークモードに切替' : 'ライトモードに切替'}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, width: 32, height: 32, borderRadius: 8, cursor: 'pointer', background: T.buttonBg, border: `1px solid ${T.border}`, color: T.textSub, fontSize: 14, transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.background = T.buttonHover; e.currentTarget.style.color = T.text }}
            onMouseLeave={e => { e.currentTarget.style.background = T.buttonBg; e.currentTarget.style.color = T.textSub }}
          >{theme === 'light' ? '🌙' : '☀️'}</button>

          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <a href={`/user/${currentUser}`} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '4px 10px', borderRadius: 8,
                background: T.accentBg, border: `1px solid ${T.accentBorder}`,
                textDecoration: 'none', cursor: 'pointer',
              }}
                title="マイページを見る"
                onMouseEnter={e => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <span style={{ fontSize: 13, color: T.accent }}>◉</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.accent, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUser}</span>
              </a>
              <button onClick={handleLogout}
                style={{ padding: '4px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.buttonBg, color: T.textMuted, fontSize: 11, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = T.buttonHover; e.currentTarget.style.color = T.text }}
                onMouseLeave={e => { e.currentTarget.style.background = T.buttonBg; e.currentTarget.style.color = T.textMuted }}
              >ログアウト</button>
            </div>
          ) : (
            <button onClick={() => setShowAuthModal(true)}
              style={{ padding: '5px 14px', borderRadius: 8, border: `1px solid ${T.accentBorder}`, background: T.accentBg, color: T.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' }}
              onMouseEnter={e => { e.currentTarget.style.background = T.accent; e.currentTarget.style.color = '#fff' }}
              onMouseLeave={e => { e.currentTarget.style.background = T.accentBg; e.currentTarget.style.color = T.accent }}
            >ログイン</button>
          )}
        </div>
      </header>

      {showAuthModal && <AuthModal onSuccess={handleAuthSuccess} onClose={() => setShowAuthModal(false)} theme={theme} />}

      {/* ── Body (sidebar + main + detail) ──────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Left Sidebar ──────────────────────────────────────────────── */}
        <aside style={{
          width: sidebarOpen ? 210 : 0,
          flexShrink: 0, overflow: 'hidden',
          background: T.sidebarBg,
          borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
          transition: 'width 0.25s ease',
          boxShadow: theme === 'light' ? '4px 0 18px rgba(15,23,42,0.04)' : 'none',
        }}>
          <div style={{ width: 210, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

            {/* Navigation */}
            <nav style={{ padding: '12px 0', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
              <SideNavItem
                icon="◉" label="類似マップ"
                active={activeView === 'similar'}
                onClick={() => { setShowSimilarMap(true); setShowFavoritesMap(false); if (selected && !treeRootManga) setTreeRootManga(selected) }}
                theme={theme}
              />
              <SideNavItem
                icon="◈" label="3Dマップ"
                active={activeView === '3d'}
                onClick={() => { setShowSimilarMap(false); setShowFavoritesMap(false) }}
                theme={theme}
              />
              <SideNavItem
                icon="♥" label={`お気に入り${favorites.size > 0 ? ` (${favorites.size})` : ''}`}
                active={activeView === 'favorites'}
                onClick={() => { setShowFavoritesMap(v => !v); setShowSimilarMap(false) }}
                accent={activeView === 'favorites' ? '#f472b6' : undefined}
                theme={theme}
              />
            </nav>

            {/* Tag selector (restored) */}
            <div style={{ padding: '12px 16px 10px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>タグ</div>
              <TagSelector
                tagList={tagList}
                selectedTags={selectedTags}
                onToggleTag={handleToggleTag}
                onClearTags={() => setSelectedTags([])}
                matchCount={tagMatchCount}
                totalCount={filteredData.length}
                variant={theme === 'dark' ? 'dark' : 'light'}
                panelStrategy="fixed"
                filterMode={tagFilterMode}
                onFilterModeChange={setTagFilterMode}
              />
            </div>

            {/* タグ絞込結果から2D探索 */}
            {selectedTags.length > 0 && tagFilteredData.length > 0 && (() => {
              const topItems = [...tagFilteredData]
                .sort((a, b) => (tagScores?.[b.id] ?? 0) - (tagScores?.[a.id] ?? 0))
                .slice(0, 8)
              return (
                <div style={{ padding: '10px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.accent, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
                    ◉ 2Dマップで探索 — {tagFilteredData.length.toLocaleString()}件
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {topItems.map(manga => (
                      <button key={manga.id}
                        onClick={() => { handleSimilarMapSearch(manga); setShowSimilarMap(true); setShowFavoritesMap(false) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.buttonBg, cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = T.buttonHover}
                        onMouseLeave={e => e.currentTarget.style.background = T.buttonBg}
                      >
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: getTagColor(manga.tags?.[0]?.name) }} />
                        <div style={{ flex: 1, fontSize: 12, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {manga.title_ja || manga.title}
                        </div>
                        <span style={{ fontSize: 11, color: T.accent, flexShrink: 0, opacity: 0.7 }}>→</span>
                      </button>
                    ))}
                    {tagFilteredData.length > 8 && (
                      <div style={{ fontSize: 10, color: T.textMuted, textAlign: 'center', paddingTop: 3 }}>
                        他 {(tagFilteredData.length - 8).toLocaleString()} 件
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* タグ検索履歴 */}
            {tagHistory.length > 0 && (
              <div style={{ padding: '10px 16px 12px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>タグ履歴</div>
                  <button onClick={clearTagHistory} style={{ fontSize: 10, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
                    onMouseEnter={e => e.currentTarget.style.color = T.textSub}
                    onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                  >すべて削除</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tagHistory.map(entry => {
                    const key = [...entry.tags].sort().join('\0')
                    const isActive = [...selectedTags].sort().join('\0') === key
                    return (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={() => applyTagHistory(entry)}
                          style={{
                            flex: 1, display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center',
                            padding: '5px 7px', borderRadius: 7, cursor: 'pointer', textAlign: 'left',
                            border: `1px solid ${isActive ? T.accentBorder : T.border}`,
                            background: isActive ? T.accentBg : T.buttonBg,
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = T.buttonHover }}
                          onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = T.buttonBg }}
                        >
                          <span style={{ fontSize: 9, color: isActive ? T.accent : T.textMuted, fontWeight: 700, marginRight: 1 }}>
                            {entry.mode}
                          </span>
                          {entry.tags.map(t => (
                            <span key={t} style={{
                              fontSize: 10, padding: '1px 5px', borderRadius: 4,
                              background: `${getTagColor(t)}22`,
                              color: getTagColor(t),
                              border: `1px solid ${getTagColor(t)}44`,
                              whiteSpace: 'nowrap',
                            }}>
                              {getTagLabel(t)}
                            </span>
                          ))}
                        </button>
                        <button onClick={() => removeTagHistory(key)}
                          style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 12, padding: '2px 4px', lineHeight: 1 }}
                          onMouseEnter={e => e.currentTarget.style.color = T.textSub}
                          onMouseLeave={e => e.currentTarget.style.color = T.textMuted}
                        >✕</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Genre filter */}
            <div style={{ padding: '14px 16px 8px', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>ジャンル</div>
              {SIDEBAR_GENRES.map(({ label, tag }) => {
                const color = getTagColor(tag)
                const active = selectedTags.includes(tag)
                return (
                  <button key={tag} onClick={() => handleToggleTag(tag)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '6px 8px', marginBottom: 2,
                      background: active ? `${color}18` : 'transparent',
                      border: `1px solid ${active ? color + '55' : 'transparent'}`,
                      borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = T.buttonHover }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: `0 0 8px ${color}99`, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: active ? T.text : T.textSub, fontWeight: active ? 700 : 500 }}>{label}</span>
                    {active && <span style={{ marginLeft: 'auto', fontSize: 10, color: color }}>✓</span>}
                  </button>
                )
              })}
            </div>

            {/* Popularity filter */}
            <div style={{ padding: '12px 16px', borderTop: `1.5px solid ${minPopularity > 1 ? POP_COLORS[minPopularity] : T.border}`, flexShrink: 0, transition: 'border-color 0.2s' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: minPopularity > 1 ? POP_COLORS[minPopularity] : T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', transition: 'color 0.2s' }}>注目度フィルター</div>
                {minPopularity > 1 && (
                  <button onClick={() => setMinPopularity(1)}
                    style={{ fontSize: 10, fontWeight: 700, color: POP_COLORS[minPopularity], background: `${POP_COLORS[minPopularity]}22`, border: `1px solid ${POP_COLORS[minPopularity]}55`, borderRadius: 5, padding: '2px 6px', cursor: 'pointer', lineHeight: 1.4 }}>
                    リセット
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {[1,2,3,4,5].map(n => {
                  const active = n >= minPopularity; const color = POP_COLORS[n]
                  return (
                    <button key={n} onClick={() => setMinPopularity(n)} title={POP_LABELS[n]}
                      style={{ background: 'none', border: 'none', padding: '2px 3px', cursor: 'pointer', fontSize: 20, color: active ? color : (theme === 'light' ? '#cbd5e1' : '#374151'), textShadow: active ? `0 0 10px ${color}88` : 'none', transition: 'color 0.15s', lineHeight: 1 }}
                      onMouseEnter={e => { e.currentTarget.style.color = color; e.currentTarget.style.transform = 'scale(1.2)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = active ? color : (theme === 'light' ? '#cbd5e1' : '#374151'); e.currentTarget.style.transform = 'scale(1)' }}
                    >{n < minPopularity ? '☆' : '★'}</button>
                  )
                })}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: minPopularity > 1 ? POP_COLORS[minPopularity] : T.textSub,
                background: minPopularity > 1 ? `${POP_COLORS[minPopularity]}18` : 'transparent',
                border: minPopularity > 1 ? `1px solid ${POP_COLORS[minPopularity]}44` : '1px solid transparent',
                borderRadius: 6, padding: minPopularity > 1 ? '3px 8px' : '3px 0',
                display: 'inline-block', transition: 'all 0.2s',
              }}>
                {minPopularity === 1 ? 'すべて表示' : `★${minPopularity}以上のみ表示`}
              </div>
            </div>

            {/* Neighbor mode */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>近傍のみ表示</div>
              <button onClick={() => setNeighborOnlyMode(v => !v)} disabled={!selected}
                style={{
                  width: '100%', padding: '8px', borderRadius: 8,
                  border: `1px solid ${neighborOnlyMode ? T.accentBorder : T.border}`,
                  background: neighborOnlyMode ? T.accentBg : T.buttonBg,
                  color: neighborOnlyMode ? T.accent : (selected ? T.textSub : '#c0c7d4'),
                  cursor: selected ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                <span>{neighborOnlyMode ? '★' : '☆'}</span>
                {neighborOnlyMode ? 'ON' : 'OFF'}
              </button>
              {neighborOnlyMode && (
                <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                  {[5,10,20,50].map(n => (
                    <button key={n} onClick={() => setNeighborOnlyCount(n)}
                      style={{ flex: 1, padding: '5px 0', borderRadius: 6, border: `1px solid ${neighborOnlyCount === n ? T.accentBorder : T.border}`, background: neighborOnlyCount === n ? T.accentBg : T.buttonBg, color: neighborOnlyCount === n ? T.accent : T.textSub, cursor: 'pointer', fontSize: 11, fontWeight: neighborOnlyCount === n ? 700 : 500 }}
                    >{n}</button>
                  ))}
                </div>
              )}
              {neighborOnlyMode && (
                <button onClick={() => {
                  if (!mapLocked) { setLockedAnchor(selected); setMapLocked(true) }
                  else { setLockedAnchor(null); setMapLocked(false) }
                }}
                  style={{ width: '100%', marginTop: 6, padding: '7px', borderRadius: 8, border: `1px solid ${mapLocked ? '#fb923c' : T.border}`, background: mapLocked ? 'rgba(251,146,60,0.15)' : T.buttonBg, color: mapLocked ? '#fb923c' : T.textSub, cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  {mapLocked ? '🔒 ロック中' : '🔓 マップをロック'}
                </button>
              )}
            </div>

            {/* 閲覧済みを候補から除外 */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10 }}>閲覧済みを除外</div>
              <button onClick={() => setHideViewedMode(v => !v)} disabled={viewed.size === 0}
                style={{
                  width: '100%', padding: '8px', borderRadius: 8,
                  border: `1px solid ${hideViewedMode ? T.accentBorder : T.border}`,
                  background: hideViewedMode ? T.accentBg : T.buttonBg,
                  color: hideViewedMode ? T.accent : (viewed.size > 0 ? T.textSub : '#c0c7d4'),
                  cursor: viewed.size > 0 ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                <span>{hideViewedMode ? '👁' : '👁'}</span>
                {hideViewedMode ? `除外中 (${viewed.size}件)` : (viewed.size > 0 ? `${viewed.size}件を除外する` : '閲覧済みなし')}
              </button>
            </div>

            {/* Bottom: フィルター button */}
            <div style={{ marginTop: 'auto', padding: '12px 16px', borderTop: `1px solid ${T.border}` }}>
              {selectedTags.length > 0 && (
                <button onClick={() => setSelectedTags([])}
                  style={{ width: '100%', padding: '8px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.buttonBg, color: T.textSub, cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  ✕ フィルター解除 ({selectedTags.length})
                </button>
              )}
              <div style={{ marginTop: 8, fontSize: 11, color: T.textMuted, textAlign: 'center' }}>
                {selectedTags.length > 0
                  ? <><span style={{ color: T.accent, fontWeight: 700 }}>{tagFilteredData.length.toLocaleString()}</span> / {filteredData.length.toLocaleString()} 作品</>
                  : <>{filteredData.length.toLocaleString()} 作品</>
                }
              </div>
            </div>
          </div>
        </aside>

        {/* ── Main canvas area ───────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

          {/* Canvas container */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {(loading || activeView === '3d') && (
              loading ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 20, background: T.appBg }}>
                  <div style={{ position: 'relative', width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2.5px solid ${T.accent}`, borderTopColor: 'transparent', animation: 'spinArc 1.4s linear infinite' }} />
                    <div style={{ position: 'absolute', inset: 14, borderRadius: '50%', border: `2px solid ${T.accent}44`, borderBottomColor: 'transparent', animation: 'spinArc 2s linear infinite reverse' }} />
                    <span style={{ fontSize: 22, color: T.accent }}>◉</span>
                  </div>
                  <div style={{ fontSize: 14, color: T.textSub, letterSpacing: '0.06em' }}>{config.label}の世界を構築中…</div>
                </div>
              ) : (
                <Suspense fallback={
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.appBg }}>
                    <div style={{ position: 'relative', width: 72, height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2.5px solid ${T.accent}`, borderTopColor: 'transparent', animation: 'spinArc 1.4s linear infinite' }} />
                      <span style={{ fontSize: 22, color: T.accent }}>◉</span>
                    </div>
                  </div>
                }>
                  <MangaMap3D
                    mangaData={displayData} selected={mapBaseSelected} neighbors={mapNeighbors}
                    focusTarget={focusTarget} onSelect={handleSelect} tagScores={tagScores}
                    neighborOnlyMode={neighborOnlyMode} mapLocked={mapLocked}
                    actualSelected={selected} tagIdf={tagIdf} theme={theme}
                  />
                </Suspense>
              )
            )}

            {/* 2D類似マップ：作品未選択の空状態 */}
            {showSimilarMap && !treeRootManga && !loading && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 18, padding: 32,
                background: theme === 'dark' ? '#0d1117' : '#f5f4f0',
              }}>
                <div style={{ fontSize: 52, opacity: 0.18, color: T.text, lineHeight: 1 }}>◉</div>
                <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>作品を選んでください</div>
                <div style={{ fontSize: 13, color: T.textSub, textAlign: 'center', lineHeight: 1.8 }}>
                  上の検索バーから作品を探してください<br />
                  または3Dマップで点をクリックしてください
                </div>
                <button
                  onClick={() => { setShowSimilarMap(false); setShowFavoritesMap(false) }}
                  style={{
                    marginTop: 4, padding: '9px 24px', borderRadius: 8,
                    background: T.buttonBg, border: `1px solid ${T.border}`,
                    color: T.textSub, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.accentBg; e.currentTarget.style.color = T.accent; e.currentTarget.style.borderColor = T.accentBorder }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.buttonBg; e.currentTarget.style.color = T.textSub; e.currentTarget.style.borderColor = T.border }}
                >
                  ◈ 3Dマップで探す
                </button>
              </div>
            )}

            {showSimilarMap && treeRootManga && (
              <SimilarityTreeMap
                rootManga={treeRootManga} computeNeighbors={computeNeighbors}
                onClose={() => { setShowSimilarMap(false); setTreeRootManga(null) }}
                onSelect={handleSelect}
                minPopularity={minPopularity} onPopularityChange={setMinPopularity}
                isMobile={false}
                onOpenFavorites={() => { setShowSimilarMap(false); setShowFavoritesMap(true) }}
                favoritesCount={favorites.size}
                mangaData={tagFilteredData}
                onRerootSearch={handleSimilarMapSearch}
                backLabel='← 3D'
                theme={theme}
                tagScores={tagScores}
              />
            )}

            {showFavoritesMap && (
              <FavoritesMap
                mangaData={mediaData} favorites={favorites}
                viewed={viewed} onClearViewed={clearViewed}
                onClose={() => setShowFavoritesMap(false)}
                onSelect={handleSelect} isMobile={false} theme={theme}
              />
            )}

            {/* History bar */}
            {history.length > 1 && (
              <div style={{ position: 'absolute', bottom: 62, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 'min(680px, calc(100vw - 80px))', display: 'grid', gridTemplateColumns: 'auto auto minmax(0, 1fr)', alignItems: 'center', gap: 6, background: theme === 'dark' ? 'rgba(13,17,23,0.96)' : 'rgba(250,249,245,0.94)', border: `1px solid ${T.border}`, borderRadius: 12, padding: '6px 10px', backdropFilter: 'blur(18px)', boxShadow: theme === 'dark' ? '0 8px 28px rgba(0,0,0,0.5)' : '0 8px 28px rgba(15,23,42,0.12)', boxSizing: 'border-box' }}>
                <button onClick={handleBack} style={{ background: T.accentBg, border: `1px solid ${T.accentBorder}`, borderRadius: 8, color: T.accent, cursor: 'pointer', padding: '5px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', transition: 'background 0.15s' }} onMouseEnter={e => e.currentTarget.style.background = T.accentBg} onMouseLeave={e => e.currentTarget.style.background = T.accentBg}>← 戻る</button>
                <div style={{ width: 1, height: 18, background: T.border, margin: '0 2px' }} />
                <div className="history-scroll" style={{ overflowX: 'auto', display: 'flex', gap: 5, minWidth: 0 }}>
                  {history.slice(0, -1).map((item, i, arr) => {
                    const isLatestPrev = i === arr.length - 1
                    const histIdx = history.findIndex(h => h.id === item.id)
                    return (
                      <button key={`${item.id}-${i}`} onClick={() => handleHistoryNav(item, histIdx + 1)}
                        style={{ background: isLatestPrev ? T.accentBg : T.buttonBg, border: `1px solid ${isLatestPrev ? T.accentBorder : T.border}`, borderRadius: 8, color: isLatestPrev ? T.accent : T.textSub, cursor: 'pointer', padding: '5px 10px', fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0, fontWeight: isLatestPrev ? 600 : 500, transition: 'all 0.12s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = T.accentBg; e.currentTarget.style.color = T.accent }}
                        onMouseLeave={e => { e.currentTarget.style.background = isLatestPrev ? T.accentBg : T.buttonBg; e.currentTarget.style.color = isLatestPrev ? T.accent : T.textSub }}
                      >{item.title}</button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Hint bar */}
            {!loading && activeView === '3d' && (
              <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', background: theme === 'dark' ? 'rgba(13,17,23,0.90)' : 'rgba(250,249,245,0.88)', border: `1px solid ${T.border}`, borderRadius: 10, padding: '7px 18px', fontSize: 11, color: T.textMuted, pointerEvents: 'none', display: 'flex', gap: 18, whiteSpace: 'nowrap', backdropFilter: 'blur(14px)', zIndex: 5, boxShadow: theme === 'dark' ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 16px rgba(15,23,42,0.08)' }}>
                {[['ドラッグ', '視点移動'], ['スクロール', 'ズーム'], ['WASD', '移動'], ['クリック', '作品を選択']].map(([key, label]) => (
                  <span key={key}>
                    <span style={{ color: T.accent, fontWeight: 600 }}>{key}</span>
                    <span style={{ marginLeft: 4 }}>{label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right Detail Panel ─────────────────────────────────────────── */}
        {selected && (
          <DetailPanel
            manga={selected} neighbors={neighbors} tagIdf={tagIdf}
            onClose={isFullscreen ? handleExitFullscreen : (showSimilarMap || showFavoritesMap) ? () => setSelected(null) : () => { setSelected(null); setShowSimilarMap(false) }}
            mapMode={false} onSelect={handleSelect} onSelectSimilarMap={handleSimilarMapSearch}
            onOpenSimilarMap={handleOpenSimilarMap} showSimilarMap={showSimilarMap}
            selectedTags={selectedTags} onTagClick={handleToggleTag} onClearTags={() => setSelectedTags([])}
            isFavorite={favorites.has(selected.id)} onToggleFavorite={() => toggleFavorite(selected)}
            isMobile={false} neighborOnlyMode={neighborOnlyMode}
            allManga={tagFilteredData} communityMode={communityMode}
            onToggleCommunityMode={() => setCommunityMode(v => !v)}
            fullscreen={isFullscreen}
            onToggleFullscreen={isFullscreen ? handleExitFullscreen : handleEnterFullscreen}
            onGoToMap={isFullscreen ? handleGoToMap : undefined}
            minPopularity={minPopularity} onPopularityChange={setMinPopularity}
            isViewed={viewed.has(selected.id)} onToggleViewed={() => toggleViewed(selected)}
            theme={theme}
            onCommunityDataChange={setCommunityData}
            communityData={communityData}
            authToken={authToken} currentUser={currentUser}
          />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

const mobileBtn = {
  background: 'rgba(109,106,248,0.14)', border: '1px solid rgba(109,106,248,0.45)',
  borderRadius: 8, color: '#6d6af8', cursor: 'pointer',
  padding: '5px 12px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
}

function SideNavItem({ icon, label, active, onClick, dimmed, accent, theme = 'light' }) {
  const isDark = theme === 'dark'
  const activeColor = accent || (isDark ? '#818cf8' : '#6d6af8')
  const baseText = isDark ? '#9ca3af' : '#6b7280'
  const dimText  = isDark ? '#374151' : '#c0c7d4'
  const hoverBg  = isDark ? 'rgba(255,255,255,0.04)' : '#f4f6fb'
  return (
    <button onClick={onClick} disabled={dimmed}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '9px 16px', textAlign: 'left',
        background: active ? `${activeColor}14` : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${active ? activeColor : 'transparent'}`,
        cursor: dimmed ? 'not-allowed' : 'pointer',
        color: active ? activeColor : dimmed ? dimText : baseText,
        fontSize: 13, fontWeight: active ? 700 : 500,
        transition: 'all 0.12s',
      }}
      onMouseEnter={e => { if (!dimmed && !active) e.currentTarget.style.background = hoverBg }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, opacity: dimmed ? 0.35 : 1 }}>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

function MapTabButton({ active, onClick, dimmed, accent, children, theme = 'light' }) {
  const isDark = theme === 'dark'
  const activeColor = accent || (isDark ? '#818cf8' : '#6d6af8')
  return (
    <button onClick={onClick} disabled={dimmed}
      style={{
        padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500,
        background: active ? `${activeColor}18` : (isDark ? 'transparent' : '#f7f9fc'),
        border: `1px solid ${active ? activeColor + '55' : (isDark ? 'transparent' : '#e5e9f2')}`,
        color: active ? activeColor : dimmed ? (isDark ? '#374151' : '#c0c7d4') : (isDark ? '#6b7280' : '#6b7280'),
        cursor: dimmed ? 'not-allowed' : 'pointer',
        transition: 'all 0.12s', whiteSpace: 'nowrap',
      }}
      onMouseEnter={e => { if (!dimmed && !active) { e.currentTarget.style.background = isDark ? 'rgba(255,255,255,0.05)' : '#eef2ff'; e.currentTarget.style.color = activeColor } }}
      onMouseLeave={e => { if (!active) { e.currentTarget.style.background = isDark ? 'transparent' : '#f7f9fc'; e.currentTarget.style.color = dimmed ? (isDark ? '#374151' : '#c0c7d4') : '#6b7280' } }}
    >
      {children}
    </button>
  )
}

function HideViewedToast({ visible, count, theme }) {
  const isDark = theme === 'dark'
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%',
      zIndex: 9999, pointerEvents: 'none',
      transition: 'opacity 0.3s, transform 0.3s',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)',
    }}>
      <div style={{
        background: isDark ? '#1e2535' : '#1e1b4b',
        color: '#c7d2fe',
        borderRadius: 12, padding: '10px 16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        maxWidth: 300, fontSize: 13, lineHeight: 1.6,
      }}>
        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>👁</span>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>既読作品を非表示 ON</div>
          <div style={{ fontSize: 12, color: '#a5b4fc' }}>閲覧済みにした{count > 0 ? `${count}作品` : '作品'}をマップから除外します</div>
        </div>
      </div>
    </div>
  )
}

function CommunityToast({ visible, theme }) {
  const isDark = theme === 'dark'
  return (
    <div style={{
      position: 'fixed', bottom: 80, left: '50%',
      zIndex: 9999, pointerEvents: 'none',
      transition: 'opacity 0.3s, transform 0.3s',
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(12px)',
    }}>
      <div style={{
        background: isDark ? '#1e2535' : '#1e1b4b',
        color: '#c7d2fe',
        borderRadius: 12, padding: '10px 16px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        maxWidth: 300, fontSize: 13, lineHeight: 1.6,
      }}>
        <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>◉</span>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>コミュニティモード ON</div>
          <div style={{ fontSize: 12, color: '#a5b4fc' }}>ユーザーが投票したタグをもとに類似作品を計算します</div>
        </div>
      </div>
    </div>
  )
}

