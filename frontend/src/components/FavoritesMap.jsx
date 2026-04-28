import { useRef, useEffect, useState, useMemo } from 'react'
import { getTagColor } from '../utils'
import { getCoverUrl } from '../lib/imageSource'
import { requestImage, getImage } from '../lib/imageLoader'

// ── Constants ─────────────────────────────────────────────────────────────────
const NW      = 68
const NH      = 96
const MIN_SIM = 0.08
const MIN_SEP = 125   // minimum center-to-center distance between nodes

// ── Cosine similarity ─────────────────────────────────────────────────────────
function cosineSim(a, b) {
  const aMap = new Map()
  let na2 = 0
  for (const t of (a.tags || []).filter(t => !t.spoiler)) {
    const w = t.rank / 100; aMap.set(t.name, w); na2 += w * w
  }
  let dot = 0, nb2 = 0
  for (const t of (b.tags || []).filter(t => !t.spoiler)) {
    const w = t.rank / 100; nb2 += w * w
    const wa = aMap.get(t.name); if (wa != null) dot += wa * w
  }
  return na2 * nb2 > 0 ? dot / Math.sqrt(na2 * nb2) : 0
}

// ── Recommendation helpers ────────────────────────────────────────────────────
// Build a weighted tag profile from a list of manga
// profile[tag] = avgRank × sqrt(coverage) — rewards both high rank and consistency
function buildProfile(mangaList) {
  if (mangaList.length === 0) return new Map()
  const tagMap = new Map()
  const n = mangaList.length
  for (const manga of mangaList) {
    for (const t of (manga.tags || []).filter(t => !t.spoiler)) {
      const e = tagMap.get(t.name) || { sum: 0, cnt: 0 }
      e.sum += t.rank / 100; e.cnt++
      tagMap.set(t.name, e)
    }
  }
  const profile = new Map()
  for (const [name, { sum, cnt }] of tagMap)
    profile.set(name, (sum / cnt) * Math.sqrt(cnt / n))
  return profile
}

// Score + top matching tags for a candidate manga against a profile
function scoreCandidate(manga, profile) {
  let dot = 0, norm = 0
  const matched = []
  for (const t of (manga.tags || []).filter(t => !t.spoiler)) {
    const pw = profile.get(t.name)
    const mw = t.rank / 100
    norm += mw * mw
    if (pw != null) { dot += pw * mw; matched.push({ name: t.name, rank: t.rank, pw }) }
  }
  let pnorm = 0
  for (const v of profile.values()) pnorm += v * v
  const sim = pnorm * norm > 0 ? dot / Math.sqrt(pnorm * norm) : 0
  const reasons = matched.sort((a, b) => b.pw * b.rank - a.pw * a.rank).slice(0, 3)
  return { sim, reasons }
}

function getRecommendations(profile, mangaData, excludeIds, count = 20) {
  if (profile.size === 0) return []
  const results = []
  for (const manga of mangaData) {
    if (excludeIds.has(manga.id)) continue
    const { sim, reasons } = scoreCandidate(manga, profile)
    if (sim > 0.05) results.push({ manga, sim, reasons })
  }
  return results.sort((a, b) => b.sim - a.sim).slice(0, count)
}

// ── Taste analysis ────────────────────────────────────────────────────────────
function analyzeTaste(favManga) {
  if (favManga.length === 0) return null
  const n = favManga.length

  // Tag aggregation
  const tagMap = new Map()
  for (const manga of favManga) {
    for (const t of (manga.tags || []).filter(t => !t.spoiler)) {
      const e = tagMap.get(t.name) || { rankSum: 0, cnt: 0 }
      e.rankSum += t.rank; e.cnt++
      tagMap.set(t.name, e)
    }
  }
  const topTags = [...tagMap.entries()]
    .map(([name, { rankSum, cnt }]) => ({
      name, color: getTagColor(name),
      avgRank: rankSum / cnt,
      coverage: cnt / n,
      score: (rankSum / cnt / 100) * Math.sqrt(cnt / n),
    }))
    .sort((a, b) => b.score - a.score).slice(0, 12)

  // Genre distribution
  const genreMap = new Map()
  for (const m of favManga) {
    const g = m.genre || m.tags?.[0]?.name || '不明'
    genreMap.set(g, (genreMap.get(g) || 0) + 1)
  }
  const topGenres = [...genreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)

  // Score stats
  const scores = favManga.filter(m => m.score > 0).map(m => m.score / 10)
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0

  // Year distribution
  const years = favManga.filter(m => m.year).map(m => m.year)
  const yearMin = years.length > 0 ? Math.min(...years) : null
  const yearMax = years.length > 0 ? Math.max(...years) : null
  const decadeMap = new Map()
  for (const y of years) {
    const d = Math.floor(y / 10) * 10
    decadeMap.set(d, (decadeMap.get(d) || 0) + 1)
  }
  const decades = [...decadeMap.entries()].sort((a, b) => a[0] - b[0])

  // Auto-generated comment
  const g1 = topGenres[0]?.[0] || '', g2 = topGenres[1]?.[0] || ''
  const t1 = topTags[0]?.name || '', t2 = topTags[1]?.name || ''
  const genreStr = g2 ? `${g1}・${g2}` : g1
  const tagStr   = t2 ? `${t1}・${t2}` : t1
  let comment = ''
  if (genreStr) comment += `${genreStr}が中心の好み。`
  if (tagStr)   comment += ` ${tagStr}の要素を持つ作品への親和性が高い。`
  if (avgScore > 8.0) comment += ` 高評価作品を中心に選んでいる。`
  if (yearMin && yearMax && yearMax - yearMin <= 10) comment += ` 特定の時代（${yearMin}年代）に集中している。`

  return { topTags, topGenres, avgScore, yearMin, yearMax, decades, comment, count: n }
}

// ── Rounded rect polyfill ─────────────────────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r)
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r)
  ctx.lineTo(x, y + r); ctx.arcTo(x,     y,     x + r, y,         r)
  ctx.closePath()
}

// ── Coordinate transforms ─────────────────────────────────────────────────────
function worldToScreen(wx, wy, cam, W, H) {
  return [(wx - cam.x) * cam.scale + W / 2, (wy - cam.y) * cam.scale + H / 2]
}
function screenToWorld(sx, sy, cam, W, H) {
  return [(sx - W / 2) / cam.scale + cam.x, (sy - H / 2) / cam.scale + cam.y]
}

// ── Physics ───────────────────────────────────────────────────────────────────
// Returns true while nodes are still meaningfully moving, false when settled.
function physicsStep(nodes, edges, dragIdx) {
  const DAMP = 0.86, GRAVITY = 0.0008

  // Skip entirely when everything has settled (saves CPU + stops trembling)
  let totalKE = 0
  for (const n of nodes) totalKE += n.vx * n.vx + n.vy * n.vy
  if (totalKE < 0.08 && dragIdx < 0) return false

  for (let i = 0; i < nodes.length; i++) {
    if (i === dragIdx) continue
    let fx = 0, fy = 0
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
      const d2 = dx * dx + dy * dy + 1, d = Math.sqrt(d2)
      if (d < MIN_SEP * 2.5) { const f = (MIN_SEP * 4000) / (d2 * d + 1); fx += (dx / d) * f; fy += (dy / d) * f }
    }
    fx += -nodes[i].x * GRAVITY; fy += -nodes[i].y * GRAVITY
    nodes[i].vx = (nodes[i].vx + fx * 0.016) * DAMP
    nodes[i].vy = (nodes[i].vy + fy * 0.016) * DAMP
    // Zero out sub-threshold velocities so nodes can actually come to rest
    if (Math.abs(nodes[i].vx) < 0.04) nodes[i].vx = 0
    if (Math.abs(nodes[i].vy) < 0.04) nodes[i].vy = 0
  }
  for (const e of edges) {
    if (e.i === dragIdx || e.j === dragIdx) continue
    const a = nodes[e.i], b = nodes[e.j]
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1
    const ideal = Math.max(MIN_SEP + 30, 160 + (1 - e.sim) * 180)
    if (d > ideal) { const f = (d - ideal) * 0.014, fx = (dx / d) * f, fy = (dy / d) * f; a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy }
  }
  for (let i = 0; i < nodes.length; i++) { if (i !== dragIdx) { nodes[i].x += nodes[i].vx; nodes[i].y += nodes[i].vy } }
  // Hard separation constraint
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y
        const d = Math.hypot(dx, dy) || 0.01
        if (d < MIN_SEP) {
          const push = (MIN_SEP - d) / 2 + 0.5, nx = dx / d, ny = dy / d
          if (i !== dragIdx) { nodes[i].x -= nx * push; nodes[i].y -= ny * push }
          if (j !== dragIdx) { nodes[j].x += nx * push; nodes[j].y += ny * push }
        }
      }
    }
  }
  return true
}

// ── Canvas render ─────────────────────────────────────────────────────────────
let favBgCache = { w: 0, h: 0, clouds: [] }
function getFavBgClouds(W, H) {
  if (favBgCache.w === W && favBgCache.h === H && favBgCache.clouds.length) return favBgCache.clouds
  // seeded pseudo random (stable per size)
  let s = (W * 73856093) ^ (H * 19349663) ^ 0x9e3779b9
  const rand = () => { s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); s ^= s >>> 16; return (s >>> 0) / 0xffffffff }
  const cloudColors = ['rgba(79,70,229,', 'rgba(14,165,233,', 'rgba(236,72,153,', 'rgba(16,185,129,']
  const clouds = []
  for (let i = 0; i < 4; i++) {
    const color = cloudColors[i % cloudColors.length]
    clouds.push({ x: rand() * W, y: rand() * H, r: Math.min(W, H) * (0.22 + rand() * 0.22), color })
  }
  favBgCache = { w: W, h: H, clouds }
  return clouds
}
function drawFavBackground(ctx, W, H, cam, theme) {
  const isLight = theme === 'light'

  ctx.fillStyle = isLight ? '#eef0f8' : '#141210'
  ctx.fillRect(0, 0, W, H)

  const bgGrd = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6)
  if (isLight) {
    bgGrd.addColorStop(0, 'rgba(180,160,240,0.09)')
    bgGrd.addColorStop(1, 'rgba(238,240,248,0)')
  } else {
    bgGrd.addColorStop(0, 'rgba(160,90,50,0.10)')
    bgGrd.addColorStop(1, 'rgba(14,12,10,0)')
  }
  ctx.fillStyle = bgGrd
  ctx.fillRect(0, 0, W, H)

  if (isLight) {
    // soft "cloud" blobs
    const clouds = getFavBgClouds(W, H)
    for (const cl of clouds) {
      const grd = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.r)
      grd.addColorStop(0, cl.color + '0.10)')
      grd.addColorStop(0.6, cl.color + '0.04)')
      grd.addColorStop(1, cl.color + '0)')
      ctx.fillStyle = grd
      ctx.beginPath(); ctx.arc(cl.x, cl.y, cl.r, 0, Math.PI * 2); ctx.fill()
    }

    // dot grid (scrolls with camera)
    const gs  = 70 * cam.scale
    const gox = ((W / 2 - cam.x * cam.scale) % gs + gs) % gs
    const goy = ((H / 2 - cam.y * cam.scale) % gs + gs) % gs
    ctx.fillStyle = 'rgba(148,163,184,0.26)'
    for (let gx = gox; gx < W; gx += gs) {
      for (let gy = goy; gy < H; gy += gs) {
        ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill()
      }
    }

    // thin grid lines (scrolls with camera)
    const ls  = 140 * cam.scale
    const lox = ((W / 2 - cam.x * cam.scale) % ls + ls) % ls
    const loy = ((H / 2 - cam.y * cam.scale) % ls + ls) % ls
    ctx.strokeStyle = 'rgba(148,163,184,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = lox; x < W; x += ls) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
    for (let y = loy; y < H; y += ls) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
    ctx.stroke()

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.20, W / 2, H / 2, Math.max(W, H) * 0.80)
    vg.addColorStop(0, 'rgba(15,23,42,0)')
    vg.addColorStop(1, 'rgba(15,23,42,0.06)')
    ctx.fillStyle = vg
    ctx.fillRect(0, 0, W, H)
  }
}

function renderFrame(canvas, nodes, edges, cam, hovIdx, selMode, selIds, theme = 'light') {
  const isLight = theme === 'light'
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  drawFavBackground(ctx, W, H, cam, theme)
  if (nodes.length === 0) return

  for (const e of edges) {
    const [ax, ay] = worldToScreen(nodes[e.i].x, nodes[e.i].y, cam, W, H)
    const [bx, by] = worldToScreen(nodes[e.j].x, nodes[e.j].y, cam, W, H)
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
    ctx.strokeStyle = isLight
      ? `rgba(140,120,200,${Math.min(0.55, e.sim * 0.85)})`
      : `rgba(200,165,110,${Math.min(0.70, e.sim * 1.0)})`
    ctx.lineWidth   = Math.max(0.6, e.sim * 2.5); ctx.stroke()
    if (e.sim > 0.35 && nodes.length <= 25) {
      ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillStyle = isLight
        ? `rgba(120,100,180,${e.sim * 0.7})`
        : `rgba(200,170,130,${e.sim * 0.75})`
      ctx.fillText(`${Math.round(e.sim * 100)}%`, (ax + bx) / 2, (ay + by) / 2)
    }
  }

  const hw = (NW / 2) * cam.scale, hh = (NH / 2) * cam.scale
  for (let i = 0; i < nodes.length; i++) {
    const [sx, sy] = worldToScreen(nodes[i].x, nodes[i].y, cam, W, H)
    const manga  = nodes[i].manga
    const color  = getTagColor(manga.tags?.[0]?.name || manga.genre)
    const isHov  = i === hovIdx
    const isSel  = selMode === 'select' ? selIds.has(nodes[i].id) : true
    const dimmed = selMode === 'select' && !isSel

    ctx.globalAlpha = dimmed ? 0.35 : 1.0

    const gR = hw * 1.6
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, gR)
    grd.addColorStop(0, color + (isHov ? '55' : '28')); grd.addColorStop(1, color + '00')
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(sx, sy, gR, 0, Math.PI * 2); ctx.fill()

    ctx.save()
    rrect(ctx, sx - hw, sy - hh, hw * 2, hh * 2, 8 * cam.scale); ctx.clip()
    const img = getImage(manga.id)
    if (img) {
      ctx.drawImage(img, sx - hw, sy - hh, hw * 2, hh * 2)
      const ov = ctx.createLinearGradient(0, sy - hh + hh * 1.1, 0, sy + hh)
      if (isLight) {
        ov.addColorStop(0, 'rgba(230,232,248,0)'); ov.addColorStop(1, 'rgba(220,222,240,0.75)')
      } else {
        ov.addColorStop(0, 'rgba(0,0,0,0)'); ov.addColorStop(1, 'rgba(0,0,0,0.70)')
      }
      ctx.fillStyle = ov; ctx.fillRect(sx - hw, sy - hh, hw * 2, hh * 2)
    } else {
      ctx.fillStyle = isLight ? '#faf9f5' : color + '1e'; ctx.fillRect(sx - hw, sy - hh, hw * 2, hh * 2)
      const url = getCoverUrl(manga); if (url) requestImage(manga.id, url)
    }
    ctx.restore()

    // Border
    rrect(ctx, sx - hw, sy - hh, hw * 2, hh * 2, 8 * cam.scale)
    const borderColor = selMode === 'select' && isSel ? '#4ade80cc'
      : isHov ? color + 'cc' : color + '77'
    ctx.strokeStyle = borderColor; ctx.lineWidth = (selMode === 'select' && isSel) ? 2.5 : isHov ? 2.2 : 1.5; ctx.stroke()

    // Badge
    const badgeSize = Math.max(10, 12 * cam.scale)
    ctx.font = `${badgeSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = isLight ? 'rgba(250,249,245,0.95)' : 'rgba(255,255,255,0.90)'
    ctx.fillRect(sx + hw - badgeSize * 1.45, sy - hh + 2, badgeSize * 1.45, badgeSize * 1.25)
    ctx.fillStyle = selMode === 'select' && isSel ? '#16a34a' : '#e05080'
    ctx.fillText(selMode === 'select' ? (isSel ? '✓' : '○') : '♥', sx + hw - badgeSize * 0.72, sy - hh + badgeSize * 0.68)

    // Title
    if (cam.scale > 0.45) {
      const fontSize = Math.max(8, Math.round(9 * cam.scale))
      ctx.font = `${fontSize}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      let title = manga.title
      const maxW = hw * 2 + 18
      while (title.length > 2 && ctx.measureText(title + '…').width > maxW) title = title.slice(0, -1)
      if (title !== manga.title) title += '…'
      const tw = ctx.measureText(title).width, ty = sy + hh + 3
      ctx.fillStyle = isLight ? 'rgba(240,242,248,0.92)' : 'rgba(20,18,16,0.82)'
      ctx.fillRect(sx - tw / 2 - 4, ty - 1, tw + 8, fontSize + 4)
      ctx.fillStyle = isLight ? (isHov ? '#1a1a2e' : '#4b5563') : (isHov ? '#f0ece8' : '#c8beb6')
      ctx.fillText(title, sx, ty)
    }

    ctx.globalAlpha = 1.0
  }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function FavoritesMap({ mangaData, favorites, onClose, onSelect, isMobile = false, theme = 'light' }) {
  const canvasRef = useRef()
  const nodesRef  = useRef([])
  const edgesRef  = useRef([])
  const camRef    = useRef({ x: 0, y: 0, scale: 1 })
  const rafRef    = useRef()
  const dragRef   = useRef(null)
  const panRef    = useRef(null)
  const hovRef    = useRef(-1)
  const dirtyRef  = useRef(true)   // true = needs a render this frame
  const themeRef  = useRef(theme)

  // theme が変わったら ref を同期して再描画フラグを立てる
  useEffect(() => { themeRef.current = theme; dirtyRef.current = true }, [theme])

  // View mode
  const [viewMode, setViewMode] = useState('network')    // 'network' | 'shelf' | 'timeline' | 'bubble'

  // Side panel state
  const [sidePanel,   setSidePanel]   = useState(null)   // null | 'recommend' | 'analysis'
  const [splitMode,   setSplitMode]   = useState(true)   // true = side-by-side (default), false = full-screen
  const [recMode,     setRecModeState]= useState('all')  // 'all' | 'select'
  const [recSelected, setRecSelected] = useState(() => new Set())
  const [shareMsg,    setShareMsg]    = useState('')

  // Refs that RAF loop and event handlers read (avoid stale closures)
  const recModeRef    = useRef('all')
  const recSelectedRef= useRef(new Set())
  const sidePanelRef  = useRef(null)

  function setRecMode(m) { recModeRef.current = m; setRecModeState(m) }
  function setSide(v)    { sidePanelRef.current = v; setSidePanel(v) }
  function toggleSide(v) { setSide(sidePanelRef.current === v ? null : v) }

  function toggleRecSel(id) {
    setRecSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      recSelectedRef.current = next
      return next
    })
  }
  function selectAllRec()  { const s = new Set(favManga.map(m => m.id)); recSelectedRef.current = s; setRecSelected(s) }
  function clearRecSel()   { recSelectedRef.current = new Set(); setRecSelected(new Set()) }

  const favManga = useMemo(() => mangaData.filter(m => favorites.has(m.id)), [mangaData, favorites])

  // When switching to select mode, pre-select all
  function enterSelectMode() {
    selectAllRec()
    setRecMode('select')
  }

  // ── Recommendations ──────────────────────────────────────────────────────
  const recSource = useMemo(() =>
    recMode === 'all' ? favManga : favManga.filter(m => recSelected.has(m.id)),
    [favManga, recMode, recSelected]
  )
  const profile = useMemo(() => buildProfile(recSource), [recSource])
  const recommendations = useMemo(() =>
    getRecommendations(profile, mangaData, favorites, 20),
    [profile, mangaData, favorites]
  )

  // ── Taste analysis ────────────────────────────────────────────────────────
  const analysis = useMemo(() => analyzeTaste(favManga), [favManga])

  // ── Node initialization ───────────────────────────────────────────────────
  useEffect(() => {
    if (favManga.length === 0) { nodesRef.current = []; edgesRef.current = []; return }
    const r = Math.max(180, favManga.length * 28)
    const existMap = new Map(nodesRef.current.map(n => [n.id, n]))
    nodesRef.current = favManga.map((m, i) => {
      const ex = existMap.get(m.id)
      if (ex) return { ...ex, manga: m }
      const a = (i / favManga.length) * Math.PI * 2
      return { id: m.id, manga: m, x: Math.cos(a) * r + (Math.random() - .5) * 30, y: Math.sin(a) * r + (Math.random() - .5) * 30, vx: 0, vy: 0 }
    })
    const edges = []
    for (let i = 0; i < favManga.length; i++)
      for (let j = i + 1; j < favManga.length; j++) {
        const s = cosineSim(favManga[i], favManga[j]); if (s > MIN_SIM) edges.push({ i, j, sim: s })
      }
    edgesRef.current = edges
    for (const m of favManga) { const url = getCoverUrl(m); if (url) requestImage(m.id, url) }
    dirtyRef.current = true
    // Give nodes initial velocity so physics engages from start
    for (const n of nodesRef.current) { n.vx = (Math.random() - 0.5) * 2; n.vy = (Math.random() - 0.5) * 2 }
  }, [favManga])

  // ── RAF loop ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true
    function tick() {
      if (!alive) return
      const canvas = canvasRef.current
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        const nodes = nodesRef.current
        const dragIdx = dragRef.current ? dragRef.current.idx : -1
        if (nodes.length > 0) {
          const moving = physicsStep(nodes, edgesRef.current, dragIdx)
          if (moving) dirtyRef.current = true
          if (dirtyRef.current) {
            renderFrame(canvas, nodes, edgesRef.current, camRef.current, hovRef.current, recModeRef.current, recSelectedRef.current, themeRef.current)
            dirtyRef.current = false
          }
        } else {
          if (dirtyRef.current) {
            const ctx = canvas.getContext('2d')
            drawFavBackground(ctx, canvas.width, canvas.height, camRef.current, themeRef.current)
            dirtyRef.current = false
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { alive = false; cancelAnimationFrame(rafRef.current) }
  }, [])

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    function resize() {
      const c = canvasRef.current; if (!c) return
      const p = c.parentElement; if (!p) return
      c.width = p.offsetWidth; c.height = p.offsetHeight
      // Canvas content is cleared when dimensions change — redraw immediately
      // instead of waiting for the next RAF tick (prevents 1-frame flash)
      const nodes = nodesRef.current
      if (nodes.length > 0) {
        renderFrame(c, nodes, edgesRef.current, camRef.current, hovRef.current, recModeRef.current, recSelectedRef.current, themeRef.current)
      } else {
        const ctx = c.getContext('2d')
        drawFavBackground(ctx, c.width, c.height, camRef.current, themeRef.current)
      }
    }
    const ro = new ResizeObserver(resize)
    if (canvasRef.current?.parentElement) { ro.observe(canvasRef.current.parentElement); resize() }
    return () => ro.disconnect()
  }, [])

  // ── Hit test ──────────────────────────────────────────────────────────────
  function hitNode(sx, sy) {
    const canvas = canvasRef.current; if (!canvas) return -1
    const cam = camRef.current
    const [wx, wy] = screenToWorld(sx, sy, cam, canvas.width, canvas.height)
    const hw = NW / 2, hh = NH / 2
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i]
      if (wx >= n.x - hw && wx <= n.x + hw && wy >= n.y - hh && wy <= n.y + hh) return i
    }
    return -1
  }

  function getCanvasXY(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    return [e.clientX - rect.left, e.clientY - rect.top]
  }

  // ── Pointer events ────────────────────────────────────────────────────────
  function onPointerDown(e) {
    e.preventDefault()
    dirtyRef.current = true
    canvasRef.current.setPointerCapture(e.pointerId)
    const [sx, sy] = getCanvasXY(e)
    const idx = hitNode(sx, sy)
    if (idx >= 0) {
      dragRef.current = { idx, moved: false, startSX: sx, startSY: sy }
      canvasRef.current.style.cursor = 'grabbing'
    } else {
      const [wx, wy] = screenToWorld(sx, sy, camRef.current, canvasRef.current.width, canvasRef.current.height)
      panRef.current = { startWX: wx, startWY: wy }
      canvasRef.current.style.cursor = 'grabbing'
    }
  }

  function onPointerMove(e) {
    e.preventDefault()
    dirtyRef.current = true
    const [sx, sy] = getCanvasXY(e)
    if (dragRef.current) {
      const d = dragRef.current
      const dx = sx - d.startSX, dy = sy - d.startSY
      if (!d.moved && dx * dx + dy * dy > 9) d.moved = true
      if (d.moved) {
        const [wx, wy] = screenToWorld(sx, sy, camRef.current, canvasRef.current.width, canvasRef.current.height)
        const node = nodesRef.current[d.idx]
        node.x = wx; node.y = wy; node.vx = 0; node.vy = 0
      }
      return
    }
    if (panRef.current) {
      const canvas = canvasRef.current
      const cam = camRef.current
      const [wx, wy] = screenToWorld(sx, sy, cam, canvas.width, canvas.height)
      cam.x -= wx - panRef.current.startWX
      cam.y -= wy - panRef.current.startWY
      return
    }
    const idx = hitNode(sx, sy)
    hovRef.current = idx
    canvasRef.current.style.cursor = idx >= 0 ? 'pointer' : 'grab'
  }

  function onPointerUp(e) {
    e.preventDefault()
    dirtyRef.current = true
    const [sx, sy] = getCanvasXY(e)
    if (dragRef.current && !dragRef.current.moved) {
      const node = nodesRef.current[dragRef.current.idx]
      if (node) {
        if (recModeRef.current === 'select') {
          // Selection mode: toggle node
          toggleRecSel(node.id)
        } else {
          onSelect(node.manga)
        }
      }
    }
    dragRef.current = null; panRef.current = null
    const idx = hitNode(sx, sy)
    hovRef.current = idx
    if (canvasRef.current) canvasRef.current.style.cursor = idx >= 0 ? 'pointer' : 'grab'
  }

  function onWheel(e) {
    e.preventDefault()
    dirtyRef.current = true
    const canvas = canvasRef.current; if (!canvas) return
    const [sx, sy] = getCanvasXY(e)
    const cam = camRef.current
    const [wx, wy] = screenToWorld(sx, sy, cam, canvas.width, canvas.height)
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    cam.scale = Math.max(0.15, Math.min(4, cam.scale * factor))
    const [nx, ny] = worldToScreen(wx, wy, cam, canvas.width, canvas.height)
    cam.x += (nx - sx) / cam.scale; cam.y += (ny - sy) / cam.scale
  }

  function handleShare() {
    const enc = btoa(JSON.stringify([...favorites]))
    const url = `${location.origin}${location.pathname}?fav=${enc}`
    navigator.clipboard.writeText(url).catch(() => {})
    setShareMsg('URLをコピーしました！'); setTimeout(() => setShareMsg(''), 2500)
  }

  // ── JSX ───────────────────────────────────────────────────────────────────
  const accentBlue = '#c43030', accentPink = '#e05080', accentGreen = '#16a34a'

  // モバイルではスプリット表示なし（常にフルスクリーン）
  const effectiveSplit = isMobile ? false : splitMode

  const isLightUI = theme === 'light'
  const favAccent = isLightUI ? '#c43030' : '#f472b6'
  const uiBorder  = isLightUI ? '#d6dbe8' : '#1e2535'
  const uiBg      = isLightUI ? '#f5f4f0' : '#0d1117'
  const uiHeaderBg= isLightUI ? 'rgba(250,249,245,0.94)' : 'rgba(17,24,39,0.97)'
  const uiText    = isLightUI ? '#0f172a' : '#e2e8f0'
  const uiMuted   = isLightUI ? '#64748b' : '#6b7280'
  const uiSub     = isLightUI ? '#475569' : '#9ca3af'

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: uiBg }}>

      {/* ── Header ── */}
      <div style={{
        flexShrink: 0,
        background: uiHeaderBg, borderBottom: `1px solid ${uiBorder}`, backdropFilter: 'blur(18px)',
        boxShadow: isLightUI ? '0 1px 10px rgba(15,23,42,0.08)' : '0 1px 12px rgba(0,0,0,0.3)',
      }}>
        {/* 上段: タイトル + シェア + 閉じる */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '10px 14px 8px' : '11px 18px' }}>
          <span style={{ fontSize: isMobile ? 14 : 16, color: favAccent }}>♥</span>
          <span style={{ fontSize: isMobile ? 13 : 14, fontWeight: 700, color: uiText, letterSpacing: '0.05em' }}>お気に入りマップ</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: favAccent, background: isLightUI ? 'rgba(196,48,48,0.08)' : 'rgba(244,114,182,0.12)', border: `1px solid ${isLightUI ? 'rgba(196,48,48,0.25)' : 'rgba(244,114,182,0.3)'}`, borderRadius: 7, padding: '2px 9px' }}>
            {favManga.length} 作品
          </span>
          <div style={{ flex: 1 }} />
          {!isMobile && (
            <button
              onClick={handleShare} disabled={favManga.length === 0}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, background: isLightUI ? '#faf9f5' : 'rgba(255,255,255,0.04)', border: `1px solid ${uiBorder}`, color: favManga.length === 0 ? (isLightUI ? '#c0bdb8' : '#374151') : uiSub, cursor: favManga.length === 0 ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700 }}
            >
              <span>🔗</span> シェア
            </button>
          )}
          {shareMsg && <span style={{ fontSize: 11, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 7, padding: '4px 10px' }}>{shareMsg}</span>}
          <button
            onClick={onClose}
            style={{ width: isMobile ? 36 : 30, height: isMobile ? 36 : 30, borderRadius: 7, flexShrink: 0, background: isLightUI ? '#faf9f5' : 'rgba(255,255,255,0.04)', border: `1px solid ${uiBorder}`, color: uiMuted, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >✕</button>
        </div>

        {/* 下段: ビュー切替 + サイドパネルタブ */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: isMobile ? 0 : 6, padding: isMobile ? '0' : '0 18px 10px', borderTop: `1px solid ${uiBorder}` }}>
          {/* View mode switcher */}
          {[
            { key: 'network',  icon: '◎', label: 'ネットワーク' },
            { key: 'shelf',    icon: '⊞', label: '本棚' },
            { key: 'timeline', icon: '≡', label: '年表' },
            { key: 'bubble',   icon: '◉', label: 'タグ' },
          ].map(({ key, icon, label }) => (
            <button key={key} onClick={() => setViewMode(key)} style={{
              flex: isMobile ? 1 : undefined,
              display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 4 : 5,
              padding: isMobile ? '11px 0' : '7px 12px',
              borderRadius: isMobile ? 0 : 8,
              background: viewMode === key ? (isLightUI ? 'rgba(196,48,48,0.10)' : 'rgba(244,114,182,0.12)') : 'transparent',
              border: isMobile ? 'none' : `1px solid ${viewMode === key ? favAccent : uiBorder}`,
              borderBottom: isMobile ? `2px solid ${viewMode === key ? favAccent : 'transparent'}` : undefined,
              color: viewMode === key ? favAccent : uiMuted,
              cursor: 'pointer', fontSize: isMobile ? 12 : 11, fontWeight: 700,
            }}>
              <span style={{ fontSize: isMobile ? 14 : 12 }}>{icon}</span>
              {(!isMobile || true) && <span>{label}</span>}
            </button>
          ))}

          {/* Divider */}
          <div style={{ width: 1, background: uiBorder, flexShrink: 0, margin: isMobile ? '8px 0' : '0' }} />

          {/* Side panel tabs */}
          {[
            { key: 'recommend', icon: '✨', label: isMobile ? 'おすすめ' : 'おすすめ' },
            { key: 'analysis',  icon: '📊', label: isMobile ? '分析' : '趣味分析' },
          ].map(({ key, icon, label }) => (
            <button key={key} onClick={() => toggleSide(key)} style={{
              flex: isMobile ? 1 : undefined,
              display: 'flex', alignItems: 'center', justifyContent: isMobile ? 'center' : 'flex-start', gap: isMobile ? 4 : 5,
              padding: isMobile ? '11px 0' : '7px 12px',
              borderRadius: isMobile ? 0 : 8,
              background: sidePanel === key ? (isLightUI ? 'rgba(99,102,241,0.10)' : 'rgba(129,140,248,0.12)') : 'transparent',
              border: isMobile ? 'none' : `1px solid ${sidePanel === key ? (isLightUI ? '#6366f1' : '#818cf8') : uiBorder}`,
              borderBottom: isMobile ? `2px solid ${sidePanel === key ? (isLightUI ? '#6366f1' : '#818cf8') : 'transparent'}` : undefined,
              color: sidePanel === key ? (isLightUI ? '#6366f1' : '#818cf8') : uiMuted,
              cursor: 'pointer', fontSize: isMobile ? 12 : 11, fontWeight: 700,
            }}>
              <span>{icon}</span> {label}
            </button>
          ))}

          {isMobile && (
            <button onClick={handleShare} disabled={favManga.length === 0} style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              padding: '11px 0', border: 'none', borderBottom: '2px solid transparent',
              background: 'transparent',
              color: favManga.length === 0 ? (isLightUI ? '#c0bdb8' : '#374151') : uiMuted,
              cursor: favManga.length === 0 ? 'not-allowed' : 'pointer', fontSize: 12, fontWeight: 700,
            }}>
              <span>🔗</span> シェア
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Main view area */}
        <div style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          display: (sidePanel && !effectiveSplit) ? 'none' : 'flex',
          flexDirection: 'column',
        }}>
          {/* Shelf / Timeline / Bubble views */}
          {viewMode === 'shelf' && <ShelfView favManga={favManga} onSelect={onSelect} isMobile={isMobile} />}
          {viewMode === 'timeline' && <TimelineView favManga={favManga} onSelect={onSelect} isMobile={isMobile} />}
          {viewMode === 'bubble' && <TagBubbleView favManga={favManga} onSelect={onSelect} isMobile={isMobile} />}

          {/* Network canvas (hidden when other view active) */}
          <div style={{ flex: 1, position: 'relative', display: viewMode === 'network' ? 'block' : 'none' }}>
          {recMode === 'select' && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 5, background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.4)',
              borderRadius: 10, padding: '8px 18px', display: 'flex', alignItems: 'center', gap: 12,
              pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              <span style={{ fontSize: 12, color: accentGreen, fontWeight: 600 }}>
                ✓ 選択モード
              </span>
              <span style={{ fontSize: 11, color: 'rgba(74,222,128,0.6)' }}>
                {recSelected.size}/{favManga.length} 選択中
              </span>
            </div>
          )}
          {favManga.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, pointerEvents: 'none', userSelect: 'none' }}>
              <div style={{ fontSize: 52, opacity: 0.2 }}>♡</div>
              <div style={{ fontSize: 15, color: '#8a8880', fontWeight: 600 }}>お気に入り作品がありません</div>
              <div style={{ fontSize: 12, color: '#c0bdb8' }}>詳細パネルの ♥ ボタンで作品を追加してください</div>
            </div>
          )}
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
            onPointerLeave={() => { hovRef.current = -1; if (canvasRef.current) canvasRef.current.style.cursor = 'grab' }}
            onWheel={onWheel}
          />
          </div>{/* end network canvas wrapper */}
        </div>{/* end main view area */}

        {/* ── Analysis panel ── */}
        {sidePanel === 'analysis' && (
          <div style={{
            width: effectiveSplit ? 460 : undefined, flex: effectiveSplit ? undefined : 1,
            flexShrink: 0, overflowY: 'auto',
            borderLeft: effectiveSplit ? `1px solid ${uiBorder}` : 'none',
            background: effectiveSplit ? (isLightUI ? 'rgba(250,249,245,0.94)' : 'rgba(17,24,39,0.98)') : undefined,
          }}>
            <AnalysisContent
              analysis={analysis} favManga={favManga}
              splitMode={effectiveSplit} onToggleSplit={() => setSplitMode(v => !v)}
              onBack={() => setSide(null)}
              isMobile={isMobile}
            />
          </div>
        )}

        {/* ── Recommend panel ── */}
        {sidePanel === 'recommend' && (
          <div style={{
            width: effectiveSplit ? 460 : undefined, flex: effectiveSplit ? undefined : 1,
            flexShrink: 0, overflowY: 'auto',
            borderLeft: effectiveSplit ? `1px solid ${uiBorder}` : 'none',
            background: effectiveSplit ? (isLightUI ? 'rgba(250,249,245,0.94)' : 'rgba(17,24,39,0.98)') : undefined,
          }}>
            <RecommendContent
              favManga={favManga}
              recMode={recMode}
              recSelected={recSelected}
              recommendations={recommendations}
              onEnterSelect={enterSelectMode}
              onExitSelect={() => setRecMode('all')}
              onSelectAll={selectAllRec}
              onClearSel={clearRecSel}
              onToggleSel={toggleRecSel}
              onSelectManga={m => onSelect(m)}
              splitMode={effectiveSplit} onToggleSplit={() => setSplitMode(v => !v)}
              onBack={() => setSide(null)}
              accentGreen={accentGreen}
              accentBlue={accentBlue}
              isMobile={isMobile}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Split-mode toggle button (shared) ────────────────────────────────────────
function SplitToggle({ splitMode, onToggle, onBack }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={onToggle}
        title={splitMode ? '全画面表示に切り替え' : 'マップと併用表示に切り替え'}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
          background: 'rgba(129,140,248,0.10)', border: '1px solid rgba(129,140,248,0.3)',
          color: '#818cf8', transition: 'all 0.15s', letterSpacing: '0.06em',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(129,140,248,0.18)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(129,140,248,0.10)' }}
      >
        {splitMode
          ? <><span style={{ fontSize: 13 }}>⛶</span> 全画面</>
          : <><span style={{ fontSize: 13 }}>⬜</span> 分割</>}
      </button>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            padding: '6px 13px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: 'rgba(255,255,255,0.04)', border: '1px solid #1e2535',
            color: '#6b7280', transition: 'all 0.15s', letterSpacing: '0.08em',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#e2e8f0' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#6b7280' }}
        >← MAP</button>
      )}
    </div>
  )
}

// ── Shelf View ────────────────────────────────────────────────────────────────
function ShelfView({ favManga, onSelect, isMobile }) {
  const [sortBy, setSortBy] = useState('score')
  const [filterTag, setFilterTag] = useState(null)

  const sorted = useMemo(() => {
    let list = filterTag ? favManga.filter(m => m.tags?.some(t => t.name === filterTag)) : favManga
    return [...list].sort((a, b) => {
      if (sortBy === 'score')  return (b.score || 0) - (a.score || 0)
      if (sortBy === 'year')   return (b.year  || 0) - (a.year  || 0)
      if (sortBy === 'title')  return (a.title_ja || a.title).localeCompare(b.title_ja || b.title)
      return 0
    })
  }, [favManga, sortBy, filterTag])

  // top tags across all favorites for filter bar
  const topTags = useMemo(() => {
    const cnt = {}
    for (const m of favManga)
      for (const t of (m.tags || []).filter(t => !t.spoiler).slice(0, 8))
        cnt[t.name] = (cnt[t.name] || 0) + 1
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name)
  }, [favManga])

  const cw = isMobile ? 80 : 100
  const ch = isMobile ? 114 : 142

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Controls */}
      <div style={{ flexShrink: 0, padding: isMobile ? '10px 14px 8px' : '12px 20px 10px', borderBottom: '1px solid #e8e6df', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#b8b4b0', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>並び順</span>
          {[['score','スコア'], ['year','新しい順'], ['title','タイトル']].map(([k, label]) => (
            <button key={k} onClick={() => setSortBy(k)} style={{
              padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              background: sortBy === k ? 'rgba(196,48,48,0.10)' : '#faf9f5',
              border: `1px solid ${sortBy === k ? '#c43030' : '#e0ddd8'}`,
              color: sortBy === k ? '#c43030' : '#8a8880',
            }}>{label}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#b8b4b0' }}>{sorted.length} 作品</span>
        </div>
        {/* Tag filter */}
        {topTags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            <button onClick={() => setFilterTag(null)} style={{
              padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: !filterTag ? 'rgba(196,48,48,0.10)' : '#faf9f5',
              border: `1px solid ${!filterTag ? '#c43030' : '#e0ddd8'}`,
              color: !filterTag ? '#c43030' : '#8a8880',
            }}>すべて</button>
            {topTags.map(tag => {
              const color = getTagColor(tag)
              const active = filterTag === tag
              return (
                <button key={tag} onClick={() => setFilterTag(active ? null : tag)} style={{
                  padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  background: active ? color + '20' : '#faf9f5',
                  border: `1px solid ${active ? color : '#e0ddd8'}`,
                  color: active ? color : '#8a8880',
                }}>{tag}</button>
              )
            })}
          </div>
        )}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 14px 20px' : '16px 20px 24px' }}>
        {sorted.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#b8b4b0', marginTop: 60, fontSize: 13 }}>該当作品なし</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cw}px, 1fr))`, gap: isMobile ? 8 : 12 }}>
            {sorted.map(m => {
              const color = getTagColor(m.tags?.[0]?.name || m.genre)
              const url   = getCoverUrl(m)
              return (
                <button key={m.id} onClick={() => onSelect(m)} style={{
                  position: 'relative', padding: 0, cursor: 'pointer', background: 'transparent',
                  border: 'none', borderRadius: 8, overflow: 'hidden',
                  outline: `1.5px solid ${color}33`,
                  transition: 'transform 0.12s, outline-color 0.12s',
                  boxShadow: `0 2px 10px rgba(0,0,0,0.4)`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.outlineColor = color }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.outlineColor = color + '33' }}
                >
                  {url
                    ? <img src={url} alt="" style={{ width: '100%', height: ch, objectFit: 'cover', objectPosition: 'top', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <div style={{ width: '100%', height: ch, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, opacity: 0.4 }}>📖</div>
                  }
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,12,0.95))', padding: '20px 5px 5px' }}>
                    <div style={{ fontSize: 9, color: '#d0d0f0', fontWeight: 600, lineHeight: 1.3, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {m.title_ja || m.title}
                    </div>
                  </div>
                  {m.score > 0 && (
                    <div style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.75)', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700, color: '#ffe066' }}>
                      ★{(m.score / 10).toFixed(1)}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Timeline View ─────────────────────────────────────────────────────────────
function TimelineView({ favManga, onSelect, isMobile }) {
  const byYear = useMemo(() => {
    const map = new Map()
    for (const m of favManga) {
      const y = m.year || '不明'
      if (!map.has(y)) map.set(y, [])
      map.get(y).push(m)
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (a[0] === '不明') return 1
        if (b[0] === '不明') return -1
        return b[0] - a[0]
      })
  }, [favManga])

  const cw = isMobile ? 58 : 72
  const ch = isMobile ? 82 : 102

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: isMobile ? '14px 14px 24px' : '20px 24px 32px' }}>
      {/* Vertical timeline */}
      <div style={{ position: 'relative' }}>
        {/* Center line */}
        <div style={{ position: 'absolute', left: isMobile ? 38 : 48, top: 0, bottom: 0, width: 2, background: 'linear-gradient(to bottom, rgba(196,48,48,0.25), rgba(196,48,48,0.08))' }} />

        {byYear.map(([year, manga]) => (
          <div key={year} style={{ display: 'flex', gap: isMobile ? 14 : 20, marginBottom: isMobile ? 24 : 32, alignItems: 'flex-start' }}>
            {/* Year label */}
            <div style={{ flexShrink: 0, width: isMobile ? 40 : 50, textAlign: 'right', paddingTop: 6 }}>
              <div style={{ fontSize: isMobile ? 13 : 15, fontWeight: 800, color: '#c43030', letterSpacing: '-0.02em', lineHeight: 1 }}>{year}</div>
              <div style={{ fontSize: 9, color: '#c0bdb8', marginTop: 2 }}>{manga.length}作品</div>
            </div>

            {/* Dot */}
            <div style={{ flexShrink: 0, width: 12, height: 12, borderRadius: '50%', background: '#c43030', boxShadow: '0 0 8px rgba(196,48,48,0.40)', marginTop: 8, zIndex: 1 }} />

            {/* Cards */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
              {manga.map(m => {
                const color = getTagColor(m.tags?.[0]?.name || m.genre)
                const url   = getCoverUrl(m)
                return (
                  <button key={m.id} onClick={() => onSelect(m)} style={{
                    position: 'relative', padding: 0, cursor: 'pointer', background: 'transparent',
                    border: 'none', borderRadius: 7, overflow: 'hidden',
                    outline: `1.5px solid ${color}44`,
                    boxShadow: `0 2px 8px rgba(0,0,0,0.5)`,
                    flexShrink: 0, width: cw,
                    transition: 'transform 0.12s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    {url
                      ? <img src={url} alt="" style={{ width: cw, height: ch, objectFit: 'cover', objectPosition: 'top', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <div style={{ width: cw, height: ch, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, opacity: 0.4 }}>📖</div>
                    }
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,12,0.95))', padding: '14px 4px 4px' }}>
                      <div style={{ fontSize: 8, color: '#c0c0e8', fontWeight: 600, lineHeight: 1.25, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {m.title_ja || m.title}
                      </div>
                    </div>
                    {m.score > 0 && (
                      <div style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.8)', borderRadius: 3, padding: '1px 4px', fontSize: 8, fontWeight: 700, color: '#ffe066' }}>
                        ★{(m.score / 10).toFixed(1)}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tag Bubble View ───────────────────────────────────────────────────────────
function TagBubbleView({ favManga, onSelect, isMobile }) {
  const [activeTag, setActiveTag] = useState(null)

  const tagStats = useMemo(() => {
    const cnt = {}
    for (const m of favManga)
      for (const t of (m.tags || []).filter(t => !t.spoiler).slice(0, 12))
        cnt[t.name] = (cnt[t.name] || 0) + 1
    return Object.entries(cnt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, isMobile ? 24 : 36)
      .map(([name, count]) => ({ name, count, color: getTagColor(name) }))
  }, [favManga, isMobile])

  const maxCount = tagStats[0]?.count || 1

  const filtered = useMemo(() =>
    activeTag ? favManga.filter(m => m.tags?.some(t => t.name === activeTag)) : [],
    [favManga, activeTag]
  )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Bubble cloud */}
      <div style={{ flex: activeTag ? '0 0 auto' : 1, overflowY: activeTag ? 'visible' : 'auto', padding: isMobile ? '14px 14px' : '20px 24px', display: 'flex', flexWrap: 'wrap', gap: isMobile ? 8 : 12, alignContent: 'flex-start', justifyContent: 'center' }}>
        {tagStats.map(({ name, count, color }) => {
          const ratio = count / maxCount
          const size  = isMobile ? (32 + ratio * 52) : (40 + ratio * 72)
          const active = activeTag === name
          return (
            <button
              key={name}
              onClick={() => setActiveTag(active ? null : name)}
              title={`${name}  ×${count}作品`}
              style={{
                width: size, height: size, borderRadius: '50%',
                background: active ? color + 'aa' : color + '22',
                border: `${active ? 2.5 : 1.5}px solid ${active ? color : color + '66'}`,
                color: active ? '#fff' : color,
                fontSize: Math.max(8, Math.round(size * 0.18)),
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 1,
                boxShadow: active ? `0 0 18px ${color}88` : `0 0 6px ${color}22`,
                transition: 'all 0.15s',
                overflow: 'hidden', padding: '4px',
                lineHeight: 1.15,
                textAlign: 'center',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = color + '44'; e.currentTarget.style.boxShadow = `0 0 14px ${color}55` } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = color + '22'; e.currentTarget.style.boxShadow = `0 0 6px ${color}22` } }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90%' }}>{name}</span>
              <span style={{ fontSize: Math.max(7, Math.round(size * 0.14)), opacity: 0.75 }}>×{count}</span>
            </button>
          )
        })}
      </div>

      {/* Filtered manga list */}
      {activeTag && (
        <div style={{ flex: 1, borderTop: '1px solid #e8e6df', overflowY: 'auto' }}>
          <div style={{ padding: isMobile ? '10px 14px 6px' : '12px 20px 8px', fontSize: 11, color: '#c43030', fontWeight: 700, letterSpacing: '0.06em' }}>
            {activeTag} — {filtered.length}作品
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 70 : 88}px, 1fr))`, gap: isMobile ? 8 : 10, padding: isMobile ? '0 14px 20px' : '0 20px 24px' }}>
            {filtered.map(m => {
              const color = getTagColor(m.tags?.[0]?.name || m.genre)
              const url   = getCoverUrl(m)
              const cw2   = isMobile ? 70 : 88
              const ch2   = isMobile ? 98 : 124
              return (
                <button key={m.id} onClick={() => onSelect(m)} style={{
                  position: 'relative', padding: 0, cursor: 'pointer', background: 'transparent',
                  border: 'none', borderRadius: 7, overflow: 'hidden',
                  outline: `1.5px solid ${color}33`, boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  transition: 'transform 0.12s',
                }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {url
                    ? <img src={url} alt="" style={{ width: '100%', height: ch2, objectFit: 'cover', objectPosition: 'top', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <div style={{ width: '100%', height: ch2, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, opacity: 0.4 }}>📖</div>
                  }
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,12,0.95))', padding: '14px 4px 4px' }}>
                    <div style={{ fontSize: 8, color: '#c0c0e8', fontWeight: 600, lineHeight: 1.25, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {m.title_ja || m.title}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Recommend panel content ───────────────────────────────────────────────────
function RecommendContent({ favManga, recMode, recSelected, recommendations, onEnterSelect, onExitSelect, onSelectAll, onClearSel, onToggleSel, onSelectManga, splitMode, onToggleSplit, onBack, accentGreen, accentBlue, isMobile = false }) {
  const cardMinWidth = (splitMode || isMobile) ? '100%' : '280px'
  const pad = isMobile ? '14px 14px 80px' : splitMode ? '20px 16px 32px' : '28px 32px 40px'

  return (
    <div style={{
      minHeight: '100%',
      background: splitMode ? 'transparent' : '#f5f4f0',
      padding: pad,
      boxSizing: 'border-box',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18, gap: 10 }}>
        <div style={{ flex: 1 }}>
          {!splitMode && !isMobile && (
            <div style={{ fontSize: 11, color: '#c0bdb8', letterSpacing: '0.14em', marginBottom: 8 }}>
              おすすめ作品
            </div>
          )}
          <div style={{ fontSize: isMobile ? 18 : splitMode ? 16 : 26, fontWeight: 900, color: '#1a1820', letterSpacing: '-0.02em', lineHeight: 1 }}>
            RECOMMENDATIONS
          </div>
        </div>
        {isMobile
          ? <button onClick={onBack} style={{ padding: '8px 16px', borderRadius: 8, background: '#faf9f5', border: '1px solid #e0ddd8', color: '#8a8880', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>← MAP</button>
          : <SplitToggle splitMode={splitMode} onToggle={onToggleSplit} onBack={splitMode ? null : onBack} />
        }
      </div>

      {/* ── Source toggle ── */}
      <div style={{ marginBottom: 18 }}>
        {!isMobile && (
          <div style={{ fontSize: 10, color: '#b8b4b0', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>
            推薦ソース
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onExitSelect}
            style={{
              flex: 1, padding: isMobile ? '13px 0' : splitMode ? '9px 0' : '12px 0', borderRadius: 10,
              background: recMode === 'all' ? 'rgba(196,48,48,0.10)' : '#faf9f5',
              border: `1px solid ${recMode === 'all' ? accentBlue : '#e0ddd8'}`,
              color: recMode === 'all' ? '#c43030' : '#8a8880',
              cursor: 'pointer', fontSize: isMobile ? 13 : splitMode ? 12 : 14, fontWeight: 700,
            }}
          >
            ♥ 全てのお気に入り
          </button>
          <button
            onClick={onEnterSelect}
            disabled={favManga.length === 0}
            style={{
              flex: 1, padding: isMobile ? '13px 0' : splitMode ? '9px 0' : '12px 0', borderRadius: 10,
              background: recMode === 'select' ? 'rgba(22,163,74,0.10)' : '#faf9f5',
              border: `1px solid ${recMode === 'select' ? accentGreen : '#e0ddd8'}`,
              color: recMode === 'select' ? accentGreen : (favManga.length === 0 ? '#d8d4ce' : '#8a8880'),
              cursor: favManga.length === 0 ? 'not-allowed' : 'pointer', fontSize: isMobile ? 13 : splitMode ? 12 : 14, fontWeight: 700,
            }}
          >
            ✓ 選択から
          </button>
        </div>
        {recMode === 'select' && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#5a7858' }}>{recSelected.size}/{favManga.length} 選択中</span>
            <button onClick={onSelectAll} style={{ fontSize: 12, color: '#16a34a', cursor: 'pointer', padding: '5px 12px', borderRadius: 6, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.22)', minHeight: isMobile ? 40 : 'auto' }}>全選択</button>
            <button onClick={onClearSel}  style={{ fontSize: 12, color: '#dc2626', cursor: 'pointer', padding: '5px 12px', borderRadius: 6, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.22)', minHeight: isMobile ? 40 : 'auto' }}>全解除</button>
          </div>
        )}
      </div>

      {/* ── 選択モード: パネル内サムネイルグリッド ── */}
      {recMode === 'select' && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 10, color: '#8a8880', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 700 }}>
            推薦に使う作品を選択 — {recSelected.size}/{favManga.length}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 72 : 80}px, 1fr))`,
            gap: isMobile ? 8 : 10,
          }}>
            {favManga.map(m => {
              const sel   = recSelected.has(m.id)
              const color = getTagColor(m.tags?.[0]?.name || m.genre)
              const url   = getCoverUrl(m)
              const cw    = isMobile ? 72 : 80
              const ch    = isMobile ? 100 : 112
              return (
                <button
                  key={m.id}
                  onClick={() => onToggleSel(m.id)}
                  style={{
                    position: 'relative', padding: 0, border: 'none',
                    borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                    outline: sel ? `2.5px solid ${accentGreen}` : `1.5px solid ${color}33`,
                    boxShadow: sel ? `0 0 14px ${accentGreen}55` : 'none',
                    transition: 'outline 0.12s, box-shadow 0.12s',
                    background: 'transparent',
                    width: '100%',
                  }}
                >
                  {url
                    ? <img src={url} alt="" style={{ width: '100%', height: ch, objectFit: 'cover', objectPosition: 'top', display: 'block' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <div style={{ width: '100%', height: ch, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, opacity: 0.4 }}>📖</div>
                  }
                  {/* タイトルのオーバーレイ */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.80))',
                    padding: '18px 5px 5px',
                  }}>
                    <div style={{ fontSize: 9, color: '#ffffff', fontWeight: 600, lineHeight: 1.3, textAlign: 'center', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {m.title}
                    </div>
                  </div>
                  {/* 選択チェックマーク */}
                  {sel && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      width: 20, height: 20, borderRadius: '50%',
                      background: accentGreen, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 900, color: '#ffffff',
                      boxShadow: `0 0 8px ${accentGreen}99`,
                    }}>✓</div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Empty states ── */}
      {recMode === 'select' && recSelected.size === 0 && (
        <div style={{ textAlign: 'center', padding: '16px 0', color: '#8a8880', fontSize: 13 }}>
          上のサムネイルから作品を選んでください
        </div>
      )}
      {recommendations.length === 0 && (recMode === 'all' || recSelected.size > 0) && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#8a8880', fontSize: 13 }}>
          {favManga.length === 0 ? 'お気に入りを追加するとおすすめが表示されます' : '候補が見つかりませんでした'}
        </div>
      )}

      {/* ── Cards ── */}
      {recommendations.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ height: 1, flex: 1, background: '#e8e6df' }} />
            <span style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.22em', fontWeight: 700 }}>
              {recommendations.length} RESULTS
            </span>
            <div style={{ height: 1, flex: 1, background: '#e8e6df' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardMinWidth}, 1fr))`, gap: isMobile ? 8 : 10 }}>
            {recommendations.map(({ manga, sim, reasons }, rank) => {
              const color = getTagColor(manga.tags?.[0]?.name || manga.genre)
              const url   = getCoverUrl(manga)
              const pct   = Math.round(sim * 100)
              const coverW = isMobile ? 80 : splitMode ? 72 : 90
              const coverH = isMobile ? 112 : splitMode ? 102 : 128
              return (
                <button
                  key={manga.id}
                  onClick={() => onSelectManga(manga)}
                  style={{
                    display: 'flex', gap: 0,
                    background: '#faf9f5', border: `1px solid ${color}33`,
                    borderRadius: 12, cursor: 'pointer', textAlign: 'left',
                    transition: 'border-color 0.18s, background 0.18s, box-shadow 0.18s',
                    overflow: 'hidden', position: 'relative', width: '100%',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                  }}
                  onMouseEnter={!isMobile ? (e => { e.currentTarget.style.borderColor = color + '80'; e.currentTarget.style.background = color + '08'; e.currentTarget.style.boxShadow = `0 4px 16px ${color}22` }) : undefined}
                  onMouseLeave={!isMobile ? (e => { e.currentTarget.style.borderColor = color + '33'; e.currentTarget.style.background = '#faf9f5'; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)' }) : undefined}
                >
                  {/* Cover */}
                  <div style={{ flexShrink: 0, position: 'relative', width: coverW }}>
                    {url
                      ? <img src={url} alt="" style={{ width: coverW, height: coverH, objectFit: 'cover', objectPosition: 'top', display: 'block', borderRight: `1px solid ${color}28` }} onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <div style={{ width: coverW, height: coverH, background: color + '18', borderRight: `1px solid ${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, opacity: 0.3 }}>📖</div>
                    }
                    <div style={{
                      position: 'absolute', top: 5, left: 5,
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'rgba(250,249,245,0.92)', border: `1px solid ${color}66`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 900, color: color, fontFamily: 'monospace',
                      pointerEvents: 'none',
                    }}>
                      {rank + 1}
                    </div>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 32, background: `linear-gradient(transparent, ${color}22)`, pointerEvents: 'none' }} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0, padding: isMobile ? '12px 12px 10px' : splitMode ? '10px 10px 8px' : '12px 14px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: isMobile ? 14 : splitMode ? 13 : 15, fontWeight: 700, color: '#1a1820', flex: 1, lineHeight: 1.35, wordBreak: 'break-all', pointerEvents: 'none' }}>
                        {manga.title}
                      </span>
                      <div style={{
                        flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
                        border: `2px solid ${color}`, boxShadow: `0 0 10px ${color}44, inset 0 0 6px ${color}18`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', background: color + '14',
                        pointerEvents: 'none',
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: color, fontFamily: 'monospace', textShadow: `0 0 8px ${color}` }}>
                          {pct}%
                        </span>
                      </div>
                    </div>

                    <div style={{ height: 4, borderRadius: 2, background: color + '18', marginBottom: 8, overflow: 'hidden', pointerEvents: 'none' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(to right, ${color}, ${color}55)`, boxShadow: `0 0 6px ${color}88`, borderRadius: 2 }} />
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, pointerEvents: 'none' }}>
                      {reasons.map(r => {
                        const rc = getTagColor(r.name)
                        return (
                          <span key={r.name} style={{
                            fontSize: 11, padding: '3px 8px', borderRadius: 20,
                            background: rc + '1e', border: `1px solid ${rc}44`,
                            color: rc, fontWeight: 700, letterSpacing: '0.03em',
                            boxShadow: `0 0 6px ${rc}28`,
                          }}>
                            {r.name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Radar chart (canvas) ──────────────────────────────────────────────────────
function RadarChart({ genres, size = 260 }) {
  const canvasRef = useRef()
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || genres.length < 3) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const cx = size / 2, cy = size / 2, r = size * 0.36
    const n = genres.length
    const maxVal = genres[0]?.[1] || 1

    ctx.clearRect(0, 0, size, size)

    // Web rings
    for (let ring = 1; ring <= 4; ring++) {
      const rr = r * ring / 4
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.strokeStyle = ring === 4 ? 'rgba(196,48,48,0.30)' : 'rgba(196,48,48,0.09)'
      ctx.lineWidth   = ring === 4 ? 1.2 : 0.7
      ctx.stroke()
    }

    // Axis spokes
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
      ctx.strokeStyle = 'rgba(196,48,48,0.15)'
      ctx.lineWidth = 0.7
      ctx.stroke()
    }

    // Data polygon fill
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      const v = genres[i][1] / maxVal
      const x = cx + Math.cos(a) * r * v, y = cy + Math.sin(a) * r * v
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(196,48,48,0.08)'
    ctx.fill()

    // Polygon stroke
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      const v = genres[i][1] / maxVal
      const x = cx + Math.cos(a) * r * v, y = cy + Math.sin(a) * r * v
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.strokeStyle = '#c43030'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.shadowBlur = 0

    // Vertex dots
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      const v = genres[i][1] / maxVal
      const color = getTagColor(genres[i][0])
      const x = cx + Math.cos(a) * r * v, y = cy + Math.sin(a) * r * v
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.shadowColor = color; ctx.shadowBlur = 10
      ctx.fill(); ctx.shadowBlur = 0
    }

    // Labels
    ctx.shadowBlur = 0
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      const lx = cx + Math.cos(a) * (r + 20), ly = cy + Math.sin(a) * (r + 20)
      const color = getTagColor(genres[i][0])
      ctx.font = `bold 8px monospace`
      ctx.textAlign    = lx < cx - 4 ? 'right' : lx > cx + 4 ? 'left' : 'center'
      ctx.textBaseline = ly < cy - 4 ? 'bottom' : ly > cy + 4 ? 'top' : 'middle'
      const label = genres[i][0].length > 9 ? genres[i][0].slice(0, 9) + '…' : genres[i][0]
      ctx.fillStyle = color
      ctx.fillText(label.toUpperCase(), lx, ly)
    }
  }, [genres, size])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}

// ── Pixel-block meter bar ─────────────────────────────────────────────────────
function PixelMeter({ value, maxValue, color, blocks = 14 }) {
  const filled = Math.round((value / (maxValue || 1)) * blocks)
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: blocks }).map((_, i) => (
        <div
          key={i}
          style={{
            width: 9, height: 11, borderRadius: 2,
            background: i < filled ? color : color + '18',
            boxShadow: i < filled ? `0 0 5px ${color}99` : 'none',
            transition: `background 0.25s ${i * 0.03}s, box-shadow 0.25s ${i * 0.03}s`,
          }}
        />
      ))}
    </div>
  )
}

// ── Analysis sub-components ───────────────────────────────────────────────────
function StatBlock({ label, value, accent = '#c43030' }) {
  return (
    <div style={{
      flex: 1, background: '#faf9f5',
      border: `1px solid #e8e6df`,
      borderRadius: 12, padding: '14px 16px',
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>
      <div style={{ fontSize: 10, color: '#b8b4b0', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, color: accent, letterSpacing: '0.04em' }}>{value}</div>
    </div>
  )
}

function ScanLabel({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <div style={{ height: 1, flex: 1, background: '#e8e6df' }} />
      <span style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.22em', textTransform: 'uppercase', fontWeight: 700, flexShrink: 0 }}>{children}</span>
      <div style={{ height: 1, flex: 1, background: '#e8e6df' }} />
    </div>
  )
}

// ── Analysis panel content ────────────────────────────────────────────────────
function AnalysisContent({ analysis, favManga, splitMode, onToggleSplit, onBack, isMobile = false }) {
  if (!analysis) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#8a8880', fontSize: 12 }}>
        お気に入りを追加すると趣味分析が表示されます
      </div>
    )
  }

  const { topTags, topGenres, avgScore, yearMin, yearMax, decades, comment, count } = analysis
  const maxTagScore = topTags[0]?.score || 1
  const maxDecade   = decades.length > 0 ? Math.max(...decades.map(d => d[1])) : 1

  const pad = isMobile ? '14px 14px 80px' : splitMode ? '20px 16px 32px' : '28px 36px 40px'
  const radarSize = isMobile ? 190 : 240

  return (
    <div style={{
      minHeight: '100%',
      background: splitMode ? 'transparent' : '#f5f4f0',
      padding: pad,
      color: '#1a1820',
      boxSizing: 'border-box',
    }}>

      {/* ── Title bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: isMobile ? 16 : 24, gap: 10 }}>
        <div style={{ flex: 1 }}>
          {!splitMode && !isMobile && (
            <div style={{ fontSize: 11, color: '#c0bdb8', letterSpacing: '0.14em', marginBottom: 8 }}>
              趣味分析
            </div>
          )}
          <div style={{ fontSize: isMobile ? 18 : splitMode ? 18 : 30, fontWeight: 900, color: '#1a1820', letterSpacing: '-0.02em', lineHeight: 1 }}>
            TASTE ANALYSIS
          </div>
        </div>
        {isMobile
          ? <button onClick={onBack} style={{ padding: '8px 16px', borderRadius: 8, background: '#faf9f5', border: '1px solid #e0ddd8', color: '#8a8880', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>← MAP</button>
          : <SplitToggle splitMode={splitMode} onToggle={onToggleSplit} onBack={splitMode ? null : onBack} />
        }
      </div>

      {/* ── Cover strip ── */}
      {favManga.length > 0 && (
        <div style={{ marginBottom: isMobile ? 18 : 28 }}>
          <ScanLabel>FAVORITES · {favManga.length} TITLES</ScanLabel>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, paddingTop: 2 }}>
            {favManga.map(m => {
              const url   = getCoverUrl(m)
              const color = getTagColor(m.tags?.[0]?.name || m.genre)
              const cw = isMobile ? 60 : 80, ch = isMobile ? 85 : 113
              return (
                <div key={m.id} style={{ flexShrink: 0, position: 'relative', width: cw }}>
                  {url
                    ? <img src={url} alt="" style={{ width: cw, height: ch, objectFit: 'cover', objectPosition: 'top', borderRadius: 7, border: `1px solid ${color}44`, boxShadow: `0 2px 8px rgba(0,0,0,0.12)`, display: 'block' }} onError={e => { e.currentTarget.style.display = 'none' }} />
                    : <div style={{ width: cw, height: ch, borderRadius: 7, background: color + '18', border: `1px solid ${color}33`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, opacity: 0.3 }}>📖</div>
                  }
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 28, background: 'linear-gradient(transparent, rgba(0,0,0,0.85))', borderRadius: '0 0 7px 7px' }} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Stats row ── */}
      <div style={{ display: 'flex', gap: isMobile ? 8 : 12, marginBottom: isMobile ? 18 : 28 }}>
        <StatBlock label="ANALYZED" value={`${count}`} />
        <StatBlock label="AVG SCORE" value={avgScore > 0 ? avgScore.toFixed(1) : 'N/A'} accent="#e05080" />
        <StatBlock label="TIME SPAN" value={yearMin && yearMax ? `${yearMin}–${yearMax}` : 'N/A'} accent="#16a34a" />
      </div>

      {/* ── AI comment ── */}
      {comment && (
        <div style={{ marginBottom: isMobile ? 18 : 28, padding: isMobile ? '12px 14px' : '16px 20px', background: 'rgba(196,48,48,0.04)', border: '1px solid rgba(196,48,48,0.15)', borderLeft: '3px solid #c43030', borderRadius: '0 12px 12px 0' }}>
          {!isMobile && <div style={{ fontSize: 10, color: '#c0bdb8', letterSpacing: '0.20em', marginBottom: 8 }}>ANALYSIS OUTPUT</div>}
          <div style={{ fontSize: isMobile ? 13 : 14, color: '#5a5858', lineHeight: 1.8 }}>{comment}</div>
        </div>
      )}

      {/* ── Main grid: radar + genres (モバイルは縦積み) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: (splitMode || isMobile) ? '1fr' : '1fr 1fr', gap: 16, marginBottom: isMobile ? 18 : 28 }}>

        {/* Radar chart */}
        <div>
          <ScanLabel>GENRE RADAR</ScanLabel>
          <div style={{
            background: '#faf9f5', borderRadius: 12,
            border: '1px solid #e8e6df',
            padding: 12, display: 'flex', justifyContent: 'center', alignItems: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            {topGenres.length >= 3
              ? <RadarChart genres={topGenres} size={radarSize} />
              : <div style={{ fontSize: 13, color: '#8a8880', padding: '30px 0' }}>ジャンルデータが少なすぎます</div>
            }
          </div>
        </div>

        {/* Genre list with pixel meters */}
        <div>
          <ScanLabel>GENRE BREAKDOWN</ScanLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topGenres.map(([genre, cnt]) => {
              const color = getTagColor(genre)
              const maxCnt = topGenres[0]?.[1] || 1
              return (
                <div key={genre} style={{
                  padding: isMobile ? '8px 10px' : '10px 12px', borderRadius: 9,
                  background: color + '0c', border: `1px solid ${color}2a`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: color, textShadow: `0 0 10px ${color}55` }}>{genre}</span>
                    <span style={{ fontSize: 11, color: color + 'aa', fontFamily: 'monospace', fontWeight: 700 }}>{cnt}</span>
                  </div>
                  <PixelMeter value={cnt} maxValue={maxCnt} color={color} blocks={isMobile ? 10 : 12} />
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Tag affinity tile grid ── */}
      <div style={{ marginBottom: isMobile ? 18 : 28 }}>
        <ScanLabel>TAG AFFINITY</ScanLabel>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : splitMode ? 'repeat(auto-fill, minmax(160px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {topTags.map((t, i) => {
            const pct = Math.round((t.score / maxTagScore) * 100)
            return (
              <div
                key={t.name}
                style={{
                  padding: isMobile ? '10px 10px' : '12px 14px', borderRadius: 10,
                  background: t.color + '0e',
                  border: `1px solid ${t.color}33`,
                  boxShadow: i < 3 ? `0 0 16px ${t.color}22` : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 7 }}>
                  <span style={{
                    fontSize: isMobile ? 12 : 13, fontWeight: 800, color: t.color,
                    textShadow: `0 0 12px ${t.color}66`,
                    letterSpacing: '0.02em', lineHeight: 1.3,
                    flex: 1, marginRight: 4,
                  }}>
                    {t.name}
                  </span>
                  <div style={{
                    flexShrink: 0, padding: '2px 6px', borderRadius: 20,
                    background: t.color + '22', border: `1px solid ${t.color}55`,
                    fontSize: 10, fontWeight: 900, color: t.color, fontFamily: 'monospace',
                  }}>
                    {pct}
                  </div>
                </div>

                <PixelMeter value={t.score} maxValue={maxTagScore} color={t.color} blocks={isMobile ? 7 : 10} />

                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: t.color + '77', fontFamily: 'monospace' }}>
                    {Math.round(t.avgRank)}%
                  </span>
                  <span style={{ fontSize: 10, color: t.color + '55', fontFamily: 'monospace' }}>
                    {Math.round(t.coverage * 100)}%cov
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Decade timeline ── */}
      {decades.length > 1 && (
        <div>
          <ScanLabel>ERA DISTRIBUTION</ScanLabel>
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            background: '#faf9f5', border: '1px solid #e8e6df',
            borderRadius: 12, padding: isMobile ? '12px 14px' : '16px 20px',
            height: isMobile ? 80 : 100,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            {decades.map(([decade, cnt]) => {
              const h = (cnt / maxDecade) * (isMobile ? 48 : 64)
              return (
                <div key={decade} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: '100%', flex: 1, display: 'flex', alignItems: 'flex-end' }}>
                    <div style={{
                      width: '100%', height: h,
                      background: 'linear-gradient(to top, #c43030, #c4303044)',
                      borderRadius: '3px 3px 0 0',
                      transition: 'height 0.5s ease-out',
                    }} />
                  </div>
                  <span style={{ fontSize: 8, color: '#b8b4b0', letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                    {decade}s
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
