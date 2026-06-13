import { useRef, useEffect, useState } from 'react'
import { getTagColor, getEffectivePop } from '../utils'
import { getTagLabel } from '../tagTranslations'
import { getCoverUrl } from '../lib/imageSource'
import { requestImage, getImage, flushQueue } from '../lib/imageLoader'
import SearchBar from './SearchBar'
import TagSelector from './TagSelector'

// ── Physics constants ─────────────────────────────────────────────────────────
const RING      = 210   // ideal world-space distance: parent → child
const MIN_DIST  = 148   // minimum clearance between node centers (> card height)
const SIM_ITER  = 60    // force-simulation iterations per placement
const EASE      = 0.062 // camera easing factor (smaller = smoother pan)
const FADE_MS   = 380   // node fade-in duration (ms)

// ── Card dimensions (world units) ────────────────────────────────────────────
const BASE_W = 100  // card width
const BASE_H = 140  // card height (portrait ~5:7)
const CARD_R = 9    // corner radius

// roundRect polyfill（古いブラウザ向け）
function rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r)
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
    ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r)
    ctx.lineTo(x, y + r); ctx.arcTo(x,     y,     x + r, y,         r)
    ctx.closePath()
  }
}

// ── Force simulation: place `newPositions` around their parent,
//    avoiding all existing nodes and each other ────────────────────────────────
function runSim(newPositions, allNodes, ring = RING) {
  for (let iter = 0; iter < SIM_ITER; iter++) {
    const damp = 0.9 - 0.55 * (iter / SIM_ITER)   // damping decreases over time

    newPositions.forEach((pos, i) => {
      let fx = 0, fy = 0

      // ① Spring: pull toward ring distance from parent (px, py)
      const dpx = pos.x - pos.px
      const dpy = pos.y - pos.py
      const dp  = Math.hypot(dpx, dpy) || 1
      const err = dp - ring
      fx -= (dpx / dp) * err * 0.20 * damp
      fy -= (dpy / dp) * err * 0.20 * damp

      // ② Repulsion from every already-placed node
      for (const [, n] of allNodes) {
        const dx = pos.x - n.x, dy = pos.y - n.y
        const d  = Math.hypot(dx, dy) || 1
        if (d < MIN_DIST) {
          const f = ((MIN_DIST - d) / d) * 0.58
          fx += dx * f; fy += dy * f
        }
      }

      // ③ Repulsion from sibling new positions
      newPositions.forEach((sib, j) => {
        if (i === j) return
        const dx = pos.x - sib.x, dy = pos.y - sib.y
        const d  = Math.hypot(dx, dy) || 1
        if (d < MIN_DIST) {
          const f = ((MIN_DIST - d) / d) * 0.44
          fx += dx * f; fy += dy * f
        }
      })

      pos.x += fx
      pos.y += fy
    })
  }
}

// ── Main component ────────────────────────────────────────────────────────────
const POP_STAR_COLORS = ['', '#64748b', '#94a3b8', '#fbbf24', '#f97316', '#ef4444']
const POP_STAR_COLORS_LIGHT = ['', '#64748b', '#94a3b8', '#d97706', '#ea580c', '#dc2626']

export default function SimilarityTreeMap({ rootManga, computeNeighbors, onClose, onSelect, minPopularity = 1, onPopularityChange, isMobile = false, onOpenFavorites, favoritesCount = 0, mangaData = [], onRerootSearch, backLabel, theme = 'light', tagScores = null, mapHistory = [], onMapBack, onMapHistoryNav, bottomOffset = 0, currentUser, onLogin, onLogout, onToggleTheme, communityMode = false, onToggleCommunityMode, hideViewedMode = false, onToggleHideViewed, viewedCount = 0, tagList, selectedTags, onToggleTag, onClearTags, tagMatchCount, tagTotalCount, tagFilterMode, onTagFilterModeChange }) {

  // All mutable data lives in refs so the RAF draw loop never needs to restart
  const canvasRef   = useRef()
  const starsRef    = useRef([])          // static star field { x, y, r, a }
  const nodesRef    = useRef(new Map())   // id → { manga, x, y, born }
  const edgesRef    = useRef(new Set())   // "idA|idB"  (sorted, deduplicated)
  const initZoom    = isMobile ? 1.35 : 1.10
  const camRef      = useRef({ x: 0, y: 0, tx: 0, ty: 0, zoom: initZoom, tzoom: initZoom })
  const focusRef    = useRef(rootManga.id)
  const histRef     = useRef([rootManga.id])
  const hovRef      = useRef(null)
  const ptrRef      = useRef(null)
  const pinchRef    = useRef(null)   // { dist, cx, cy } for pinch-zoom
  const rafRef      = useRef()
  const minPopRef    = useRef(minPopularity)  // draw loop で読む用
  const themeRef     = useRef(theme)         // draw loop で読む用
  const tagScoresRef = useRef(tagScores)     // draw loop で読む用
  const lastNavRef   = useRef(0)             // 最後にノードをナビゲートした時刻（ms）
  const NAV_COOLDOWN = 300                   // 連続クリックのクールダウン（ms）

  // theme が変わったら ref を同期
  useEffect(() => { themeRef.current = theme }, [theme])

  // tagScores が変わったら ref を同期
  useEffect(() => { tagScoresRef.current = tagScores }, [tagScores])

  // minPopularity が変わったら ref を同期し、ツリーを再構成
  useEffect(() => {
    minPopRef.current = minPopularity
    // 初期化直後（ノードが rootManga だけ）はスキップ
    if (nodesRef.current.size <= 1) return
    reconstructForFilter()
  }, [minPopularity]) // eslint-disable-line

  // Minimal React state – only for re-rendering the header
  const [ui, setUi]           = useState({ focusId: rootManga.id, history: [rootManga.id], nodeCount: 1 })
  const [tooltip, setTooltip] = useState(null)

  // ノードが表示対象かどうか（フォーカス・履歴は常に表示）
  function isVisible(id, pop) {
    if (id === focusRef.current) return true
    if (histRef.current.includes(id)) return true
    return (pop || 3) >= minPopRef.current
  }

  // ── フィルター変更時の再構成 ─────────────────────────────────────────────
  // 1. 閾値未満のノードを削除（フォーカス・履歴は保持）
  // 2. 孤立エッジを削除
  // 3. 残った可視ノードから再展開（隠れていた適格ノードを発見）
  function reconstructForFilter() {
    const nodes = nodesRef.current
    const edges = edgesRef.current

    // 削除対象を収集
    const toRemove = []
    nodes.forEach((node, id) => {
      if (!isVisible(id, getEffectivePop(node.manga))) toRemove.push(id)
    })
    toRemove.forEach(id => nodes.delete(id))

    // 孤立エッジを削除
    const deadEdges = []
    edges.forEach(key => {
      const [idA, idB] = key.split('|')
      if (!nodes.has(idA) || !nodes.has(idB)) deadEdges.push(key)
    })
    deadEdges.forEach(key => edges.delete(key))

    // フォーカスノードのみ再展開（全履歴から展開すると大量ノードが出現するため）
    if (nodes.has(focusRef.current)) {
      expandNode(focusRef.current, null)
    }

    setUi(prev => ({ ...prev, nodeCount: nodes.size }))
  }

  // ── Expand neighbors of a node ───────────────────────────────────────────
  function expandNode(mangaId, parentPos) {
    const nodes     = nodesRef.current
    const edges     = edgesRef.current
    const centerNode = nodes.get(mangaId)
    if (!centerNode) return

    const ringDist  = isMobile ? 145 : RING
    const MIN_FRESH = 3
    const BASE_COUNT = isMobile ? 5 : 8

    // First pass: standard fetch for edges
    let neighbors = computeNeighbors(centerNode.manga, BASE_COUNT)
    neighbors.forEach(n => edges.add([mangaId, n.id].sort().join('|')))
    let fresh = neighbors.filter(n => !nodes.has(n.id))

    // If fewer than MIN_FRESH new nodes, fetch a larger pool to find unseen works
    if (fresh.length < MIN_FRESH) {
      const extraCount = nodes.size + 4
      const extra = computeNeighbors(centerNode.manga, Math.min(extraCount, 50))
      extra.forEach(n => edges.add([mangaId, n.id].sort().join('|')))
      fresh = extra.filter(n => !nodes.has(n.id)).slice(0, BASE_COUNT)
    }

    if (fresh.length === 0) return

    // ── Initial seed positions around center ────────────────────────────
    // Bias outward away from grandparent so the graph grows forward
    let biasAngle = 0
    if (parentPos) {
      biasAngle = Math.atan2(centerNode.y - parentPos.y, centerNode.x - parentPos.x)
    }

    const newPositions = fresh.map((_, i) => {
      // Seed on a small circle; spread is full 360° so the sim has room to work
      const a = biasAngle + (i / fresh.length) * Math.PI * 2
      return {
        // Store parent coords for the spring force
        px: centerNode.x,
        py: centerNode.y,
        // Start at 40% of ring distance so repulsion has space to push outward
        x: centerNode.x + Math.cos(a) * ringDist * 0.4,
        y: centerNode.y + Math.sin(a) * ringDist * 0.4,
      }
    })

    // Run force simulation (synchronous, fast for ≤8 new nodes)
    runSim(newPositions, nodes, ringDist)

    // Commit positions
    const now = Date.now()
    fresh.forEach((n, i) => {
      nodes.set(n.id, {
        manga: n,
        x: newPositions[i].x,
        y: newPositions[i].y,
        born: now,
      })
    })
  }

  // ── Navigate: focus a node and expand it ────────────────────────────────
  function navigateTo(manga) {
    const now = Date.now()
    if (now - lastNavRef.current < NAV_COOLDOWN) return  // 連続クリック制限
    lastNavRef.current = now

    const targetNode = nodesRef.current.get(manga.id)
    if (!targetNode) return

    const currentNode = nodesRef.current.get(focusRef.current)
    expandNode(manga.id, currentNode ? { x: currentNode.x, y: currentNode.y } : null)

    if (isMobile) {
      // モバイル: 展開後に全ノードが収まるよう自動フィット
      setTimeout(() => zoomToFit(), 50)
    } else {
      // デスクトップ: クリックしたノードへスムーズパン
      camRef.current.tx    = targetNode.x
      camRef.current.ty    = targetNode.y
      camRef.current.tzoom = Math.min(camRef.current.zoom, 1.10)
    }

    // Update history (jumping back collapses forward history)
    const hist = histRef.current
    const idx  = hist.indexOf(manga.id)
    histRef.current  = idx !== -1 ? hist.slice(0, idx + 1) : [...hist, manga.id]
    focusRef.current = manga.id

    setUi({ focusId: manga.id, history: [...histRef.current], nodeCount: nodesRef.current.size })
    onSelect(manga)
  }

  // ── Camera helpers ───────────────────────────────────────────────────────
  function zoomToFit() {
    const nodes  = nodesRef.current
    const canvas = canvasRef.current
    if (!nodes.size || !canvas) return
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    nodes.forEach(n => {
      if (n.x < x0) x0 = n.x; if (n.x > x1) x1 = n.x
      if (n.y < y0) y0 = n.y; if (n.y > y1) y1 = n.y
    })
    const PAD = 100
    const nz  = Math.min(
      canvas.width  / (x1 - x0 + PAD * 2),
      canvas.height / (y1 - y0 + PAD * 2),
      1.4
    )
    camRef.current.tx    = (x0 + x1) / 2
    camRef.current.ty    = (y0 + y1) / 2
    camRef.current.tzoom = Math.max(nz, 0.14)
  }

  function reCenter() {
    const n = nodesRef.current.get(focusRef.current)
    if (!n) return
    camRef.current.tx    = n.x
    camRef.current.ty    = n.y
    camRef.current.tzoom = isMobile ? 1.35 : 1.10
  }

  // ── Initialise ───────────────────────────────────────────────────────────
  useEffect(() => {
    flushQueue()   // 前のルートで溜まった pending 画像リクエストをクリア
    nodesRef.current.clear()
    edgesRef.current.clear()
    lastNavRef.current = 0
    const now = Date.now()
    nodesRef.current.set(rootManga.id, { manga: rootManga, x: 0, y: 0, born: now })
    expandNode(rootManga.id, null)
    camRef.current   = { x: 0, y: 0, tx: 0, ty: 0, zoom: 0.80, tzoom: 0.80 }
    focusRef.current = rootManga.id
    histRef.current  = [rootManga.id]
    setUi({ focusId: rootManga.id, history: [rootManga.id], nodeCount: nodesRef.current.size })
  }, [rootManga.id]) // eslint-disable-line

  // ── Draw loop (runs forever; reads only from refs) ───────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function resize() {
      canvas.width  = canvas.offsetWidth  || 800
      canvas.height = canvas.offsetHeight || 600
      // Regenerate static background decor (seeded so it doesn't jump on re-render)
      const W = canvas.width, H = canvas.height
      const stars = []
      let s = 0x9e3779b9
      const rand = () => { s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); s ^= s >>> 16; return (s >>> 0) / 0xffffffff }

      // Dark-mode stars
      for (let i = 0; i < 280; i++) stars.push({ x: rand() * W, y: rand() * H, r: rand() * 1.1 + 0.4, a: rand() * 0.45 + 0.15, bright: false })
      for (let i = 0; i < 18; i++)  stars.push({ x: rand() * W, y: rand() * H, r: rand() * 1.8 + 1.2, a: rand() * 0.35 + 0.55, bright: true })

      // Dark-mode nebula blobs
      const nebulaColors = ['rgba(80,40,180,', 'rgba(40,20,140,', 'rgba(100,60,200,', 'rgba(30,50,160,', 'rgba(60,20,120,']
      const nebulae = []
      for (let i = 0; i < 5; i++) nebulae.push({ x: rand() * W, y: rand() * H, r: Math.min(W, H) * (0.18 + rand() * 0.16), color: nebulaColors[i] })

      const clouds = []

      starsRef.current = { stars, nebulae, clouds }
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas.parentElement || canvas)
    resize()

    function draw() {
      const cam = camRef.current
      // Ease camera position and zoom simultaneously
      cam.x    += (cam.tx    - cam.x)    * EASE
      cam.y    += (cam.ty    - cam.y)    * EASE
      cam.zoom += (cam.tzoom - cam.zoom) * EASE

      const W = canvas.width, H = canvas.height
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, W, H)
      const isLight = themeRef.current === 'light'

      // Background
      ctx.fillStyle = isLight ? '#f5f4f0' : '#00000a'
      ctx.fillRect(0, 0, W, H)
      const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7)
      if (isLight) {
        bg.addColorStop(0, 'rgba(124,116,104,0.06)')
        bg.addColorStop(1, 'rgba(245,244,240,0)')
      } else {
        bg.addColorStop(0, 'rgba(60,40,120,0.18)')
        bg.addColorStop(1, 'rgba(0,0,10,0)')
      }
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)

      const { x: cx, y: cy, zoom } = cam
      const toSX = wx => W / 2 + (wx - cx) * zoom
      const toSY = wy => H / 2 + (wy - cy) * zoom

      if (!isLight) {
        // Nebula blobs + stars (dark mode)
        const { stars, nebulae } = starsRef.current.stars ? starsRef.current : { stars: [], nebulae: [] }
        for (const nb of nebulae) {
          const grd = ctx.createRadialGradient(nb.x, nb.y, 0, nb.x, nb.y, nb.r)
          grd.addColorStop(0, nb.color + '0.13)')
          grd.addColorStop(0.5, nb.color + '0.06)')
          grd.addColorStop(1, nb.color + '0)')
          ctx.fillStyle = grd
          ctx.beginPath(); ctx.arc(nb.x, nb.y, nb.r, 0, Math.PI * 2); ctx.fill()
        }
        for (const st of stars) {
          ctx.globalAlpha = st.a
          ctx.fillStyle = st.bright ? '#e8e0ff' : '#b0a8e8'
          ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // Dot grid (scrolls with camera)
      const gs  = 70 * zoom
      const gox = ((W / 2 - cx * zoom) % gs + gs) % gs
      const goy = ((H / 2 - cy * zoom) % gs + gs) % gs
      ctx.fillStyle = isLight ? 'rgba(124,116,104,0.22)' : 'rgba(80,65,160,0.28)'
      for (let gx = gox; gx < W; gx += gs) {
        for (let gy = goy; gy < H; gy += gs) {
          ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill()
        }
      }

      // Thin grid lines (light mode only; scrolls with camera)
      if (isLight) {
        const ls  = 140 * zoom
        const lox = ((W / 2 - cx * zoom) % ls + ls) % ls
        const loy = ((H / 2 - cy * zoom) % ls + ls) % ls
        ctx.strokeStyle = 'rgba(124,116,104,0.10)'
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = lox; x < W; x += ls) { ctx.moveTo(x, 0); ctx.lineTo(x, H) }
        for (let y = loy; y < H; y += ls) { ctx.moveTo(0, y); ctx.lineTo(W, y) }
        ctx.stroke()
      }

      // Subtle vignette (light mode only)
      if (isLight) {
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.20, W / 2, H / 2, Math.max(W, H) * 0.78)
        vg.addColorStop(0, 'rgba(15,23,42,0)')
        vg.addColorStop(1, 'rgba(15,23,42,0.06)')
        ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)
      }

      const hist    = histRef.current
      const focusId = focusRef.current
      const hovId   = hovRef.current
      const now     = Date.now()

      // Build path-edge set for highlighting the traversal path
      const pathEdges = new Set()
      for (let i = 0; i < hist.length - 1; i++) {
        pathEdges.add([hist[i], hist[i + 1]].sort().join('|'))
      }

      // Build direct-neighbor set of the current focus node
      const directIds = new Set()
      edgesRef.current.forEach(key => {
        const [a, b] = key.split('|')
        if (a === focusId) directIds.add(b)
        else if (b === focusId) directIds.add(a)
      })

      // ── Edges ────────────────────────────────────────────────────────
      edgesRef.current.forEach(key => {
        const [idA, idB] = key.split('|')
        const nA = nodesRef.current.get(idA), nB = nodesRef.current.get(idB)
        if (!nA || !nB) return
        // 両端とも非表示なら描かない
        if (!isVisible(idA, getEffectivePop(nA.manga)) || !isVisible(idB, getEffectivePop(nB.manga))) return
        const ax = toSX(nA.x), ay = toSY(nA.y)
        const bx = toSX(nB.x), by = toSY(nB.y)

        // Skip edges completely off-screen
        if (Math.min(ax, bx) > W + 20 || Math.max(ax, bx) < -20 ||
            Math.min(ay, by) > H + 20 || Math.max(ay, by) < -20) return

        const onPath = pathEdges.has(key)
        if (onPath) {
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
          ctx.strokeStyle = isLight ? 'rgba(110,90,220,0.15)' : 'rgba(145,125,255,0.18)'
          ctx.lineWidth = 7; ctx.stroke()
        }
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by)
        ctx.strokeStyle = onPath
          ? (isLight ? 'rgba(100,80,210,0.65)' : 'rgba(145,125,255,0.68)')
          : (isLight ? 'rgba(140,130,200,0.28)' : 'rgba(72,62,145,0.30)')
        ctx.lineWidth   = onPath ? 2.5 : 1.2
        ctx.stroke()
      })

      // ── Nodes (focus last so it renders on top) ───────────────────────
      const entries = [...nodesRef.current.entries()]
      entries.sort(([a], [b]) => (a === focusId ? 1 : b === focusId ? -1 : 0))

      entries.forEach(([id, node]) => {
        const pop = getEffectivePop(node.manga)
        // 注目度フィルター（フォーカス・履歴は常に表示）
        if (!isVisible(id, pop)) return

        const sx = toSX(node.x), sy = toSY(node.y)
        if (sx < -160 || sx > W + 160 || sy < -160 || sy > H + 160) return

        const isFocus  = id === focusId
        const isHov    = id === hovId
        const inPath   = hist.includes(id)
        const isDirect = directIds.has(id)
        const color    = getTagColor(node.manga.genre || node.manga.tags?.[0]?.name)

        // Card dimensions in screen space
        const scale = (0.70 + pop * 0.07) * (isFocus ? 1.18 : isHov ? 1.06 : 1.0)
        const cw = BASE_W * zoom * scale
        const ch = BASE_H * zoom * scale
        const cr = CARD_R * zoom * scale
        const clx = sx - cw / 2   // card left
        const cty = sy - ch / 2   // card top

        // Fade-in progress for newly placed nodes
        const age    = node.born ? Math.min((now - node.born) / FADE_MS, 1) : 1

        // Tag filter: フォーカス・パスは常に高 alpha、それ以外はスコアで制御
        const ts = tagScoresRef.current
        let dAlpha
        if (isFocus) {
          dAlpha = 1.0
        } else if (inPath) {
          dAlpha = 0.92
        } else if (ts !== null) {
          const score = ts[id] ?? 0
          dAlpha = score > 0 ? Math.min(1.0, 0.55 + score * 0.45) : 0.10
        } else {
          dAlpha = isDirect ? 0.85 : isHov ? 0.78 : 0.60
        }
        const alpha  = dAlpha * age

        // タグマッチしているかどうか（ハイライト用）
        const tagMatch = ts !== null && (ts[id] ?? 0) > 0

        // Glow halo (soft, behind the card)
        if ((isFocus || isHov || inPath || isDirect || tagMatch) && age > 0.05) {
          const gr  = Math.max(cw, ch) * (isFocus ? 1.2 : isDirect ? 0.75 : 0.65)
          const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr)
          const glowIntensity = isFocus ? 0.25 : 0.12
          const ga  = Math.round(alpha * glowIntensity * 255).toString(16).padStart(2, '0')
          grd.addColorStop(0, color + ga); grd.addColorStop(1, color + '00')
          ctx.globalAlpha = 1
          ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2)
          ctx.fillStyle = grd; ctx.fill()
        }

        // Focus rings
        if (isFocus) {
          ctx.globalAlpha = alpha * 0.85
          const p1 = 5 * zoom * scale, p2 = 13 * zoom * scale
          const focusColor = isLight ? '#5046e5' : '#c43030'
          rrect(ctx, clx - p1, cty - p1, cw + p1 * 2, ch + p1 * 2, cr + p1)
          ctx.strokeStyle = focusColor + 'cc'; ctx.lineWidth = 1.8 * zoom; ctx.stroke()
          rrect(ctx, clx - p2, cty - p2, cw + p2 * 2, ch + p2 * 2, cr + p2)
          ctx.strokeStyle = focusColor + '33'; ctx.lineWidth = 1; ctx.stroke()
          ctx.globalAlpha = 1
        }

        // Card body
        const coverImg = getImage(id)
        ctx.globalAlpha = alpha

        ctx.save()
        rrect(ctx, clx, cty, cw, ch, cr); ctx.clip()

        if (coverImg) {
          ctx.drawImage(coverImg, clx, cty, cw, ch)
          // Dim non-focused cards for depth
          if (!isFocus) {
            ctx.fillStyle = isLight
              ? `rgba(245,244,240,${(1 - dAlpha) * 0.35})`
              : `rgba(0,0,12,${(1 - dAlpha) * 0.40})`
            ctx.fillRect(clx, cty, cw, ch)
          }
          // Bottom gradient for title readability
          const grad = ctx.createLinearGradient(clx, cty + ch * 0.52, clx, cty + ch)
          if (isLight) {
            grad.addColorStop(0, 'rgba(250,249,245,0)')
            grad.addColorStop(1, 'rgba(235,233,226,0.92)')
          } else {
            grad.addColorStop(0, 'rgba(20,15,10,0)')
            grad.addColorStop(1, 'rgba(20,15,10,0.88)')
          }
          ctx.fillStyle = grad; ctx.fillRect(clx, cty + ch * 0.52, cw, ch * 0.48)
        } else {
          const grad = ctx.createLinearGradient(clx, cty, clx, cty + ch)
          grad.addColorStop(0, color + '44'); grad.addColorStop(1, color + '10')
          ctx.fillStyle = isLight ? '#faf9f5' : color + '1a'; ctx.fillRect(clx, cty, cw, ch)
          ctx.fillStyle = grad; ctx.fillRect(clx, cty, cw, ch)
          requestImage(id, getCoverUrl(node.manga))
        }

        ctx.restore()

        // Genre border
        ctx.globalAlpha = alpha
        rrect(ctx, clx, cty, cw, ch, cr)
        ctx.strokeStyle = isFocus
          ? (isLight ? '#5046e5ee' : '#c43030ee')
          : color + (tagMatch ? 'cc' : isDirect ? '88' : '44')
        ctx.lineWidth   = (isFocus ? 2.2 : tagMatch ? 1.6 : 1.2) * zoom * scale
        ctx.stroke()

        // Title text
        if (zoom > 0.22 && age > 0.3) {
          const title    = node.manga.title_ja || node.manga.title
          const fontSize = Math.min(11, Math.max(6, 9 * zoom * scale))
          ctx.font       = `${isFocus ? '700' : '500'} ${fontSize}px 'Exo 2',sans-serif`
          ctx.textAlign  = 'center'
          const maxTW = cw - 4
          ctx.globalAlpha = alpha
          ctx.fillStyle = isLight
            ? (isFocus ? '#1a1a2e' : inPath ? '#2a2a3e' : '#6b7280')
            : (isFocus ? '#f0f0ff' : inPath ? '#d0d0f0' : '#a8a8c8')
          ctx.save()
          ctx.beginPath(); ctx.rect(clx, cty + ch * 0.5, cw, ch * 0.5); ctx.clip()
          ctx.fillText(title, sx, cty + ch - 4 * zoom * scale, maxTW)
          ctx.restore()
        }

        ctx.globalAlpha = 1
      })

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)

    // ゴーストクリック防止: touchend を non-passive で登録し preventDefault()
    // タップ後に生成される合成 click イベントがバックドロップに届かないようにする
    function blockGhostClick(e) { e.preventDefault() }
    canvas.addEventListener('touchend', blockGhostClick, { passive: false })

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
      canvas.removeEventListener('touchend', blockGhostClick)
    }
  }, []) // eslint-disable-line — draw loop reads only via refs

  // ── Hit test ─────────────────────────────────────────────────────────────
  function hitTest(cx, cy) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const mx = cx - rect.left, my = cy - rect.top
    const cam = camRef.current
    const W = canvas.width, H = canvas.height
    const zoom = cam.zoom
    let bestId = null, bestArea = Infinity

    nodesRef.current.forEach((node, id) => {
      const pop = getEffectivePop(node.manga)
      if (!isVisible(id, pop)) return   // フィルター外は当たり判定なし
      const sx  = W / 2 + (node.x - cam.x) * zoom
      const sy  = H / 2 + (node.y - cam.y) * zoom
      const sc  = 0.70 + pop * 0.07
      const cw  = BASE_W * zoom * sc
      const ch  = BASE_H * zoom * sc
      const pad = 4   // extra hit padding
      if (mx >= sx - cw/2 - pad && mx <= sx + cw/2 + pad &&
          my >= sy - ch/2 - pad && my <= sy + ch/2 + pad) {
        const area = cw * ch
        if (area < bestArea) { bestArea = area; bestId = id }
      }
    })
    return bestId
  }

  // ── Pointer events ────────────────────────────────────────────────────────
  function onPointerDown(e) {
    e.preventDefault()
    const { x, y } = camRef.current
    ptrRef.current = { px: e.clientX, py: e.clientY, cx: x, cy: y, moved: false }
    canvasRef.current.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    const ptr = ptrRef.current
    if (ptr) {
      const dx = e.clientX - ptr.px, dy = e.clientY - ptr.py
      if (dx * dx + dy * dy > 6) ptr.moved = true
      if (ptr.moved) {
        const z = camRef.current.zoom
        camRef.current.x  = ptr.cx - dx / z
        camRef.current.y  = ptr.cy - dy / z
        camRef.current.tx = camRef.current.x
        camRef.current.ty = camRef.current.y
      }
    }

    // モバイルではホバー中のドラッグにツールチップは出さない
    if (isMobile) return

    const id = hitTest(e.clientX, e.clientY)
    if (id !== hovRef.current) {
      hovRef.current = id
      if (canvasRef.current) canvasRef.current.style.cursor = id ? 'pointer' : 'grab'
      if (id) {
        const node     = nodesRef.current.get(id)
        const rect     = canvasRef.current.getBoundingClientRect()
        const cam      = camRef.current
        const W        = canvasRef.current.width, H = canvasRef.current.height
        const pop2     = getEffectivePop(node.manga)
        const sc2      = 0.70 + pop2 * 0.07
        const ch2      = BASE_H * cam.zoom * sc2

        // フォーカスノードとの共通タグ（rank付き）を計算
        let commonTags = []
        if (id !== focusRef.current) {
          const focusNode = nodesRef.current.get(focusRef.current)
          if (focusNode) {
            const focusTagMap = new Map((focusNode.manga.tags || []).map(t => [t.name, t]))
            commonTags = (node.manga.tags || [])
              .filter(t => !t.spoiler && focusTagMap.has(t.name))
              .map(t => ({ name: t.name, rank: t.rank, rankFocus: focusTagMap.get(t.name).rank }))
              .sort((a, b) => b.rank - a.rank)
              .slice(0, 6)
          }
        }

        setTooltip({
          title: node.manga.title_ja || node.manga.title,
          commonTags,
          x: rect.left + W / 2 + (node.x - cam.x) * cam.zoom,
          y: rect.top  + H / 2 + (node.y - cam.y) * cam.zoom - ch2 / 2,
        })
      } else setTooltip(null)
    }
  }

  function onPointerUp(e) {
    const ptr = ptrRef.current
    canvasRef.current?.releasePointerCapture(e.pointerId)
    if (ptr && !ptr.moved) {
      const id = hitTest(e.clientX, e.clientY)
      if (id) navigateTo(nodesRef.current.get(id).manga)
    }
    ptrRef.current = null
  }

  function onWheel(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const rect   = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left - canvas.width  / 2
    const my = e.clientY - rect.top  - canvas.height / 2
    const cam    = camRef.current
    const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14
    const nz     = Math.min(Math.max(cam.zoom * factor, 0.12), 6)
    cam.x  += mx / cam.zoom - mx / nz
    cam.y  += my / cam.zoom - my / nz
    cam.tx = cam.x; cam.ty = cam.y
    cam.zoom = nz; cam.tzoom = nz
  }

  function onTouchStart(e) {
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1]
      pinchRef.current = {
        dist: Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY),
        cx: (t0.clientX + t1.clientX) / 2,
        cy: (t0.clientY + t1.clientY) / 2,
        zoom: camRef.current.zoom,
        camX: camRef.current.x,
        camY: camRef.current.y,
      }
      ptrRef.current = null  // ドラッグとの競合を防ぐ
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault()
      const t0 = e.touches[0], t1 = e.touches[1]
      const dist   = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY)
      const canvas = canvasRef.current
      const rect   = canvas.getBoundingClientRect()
      const p      = pinchRef.current
      const nz     = Math.min(Math.max(p.zoom * (dist / p.dist), 0.12), 6)
      // ピンチ中心点（キャンバス中心基準のスクリーン座標）
      const mx = p.cx - rect.left - canvas.width  / 2
      const my = p.cy - rect.top  - canvas.height / 2
      // 中心点ワールド座標が変わらないよう cam を計算
      const cam = camRef.current
      cam.x = p.camX + mx / p.zoom - mx / nz
      cam.y = p.camY + my / p.zoom - my / nz
      cam.tx = cam.x; cam.ty = cam.y
      cam.zoom = nz; cam.tzoom = nz
    }
  }

  function onTouchEnd() {
    pinchRef.current = null
  }

  // ── Clean up: 履歴以外のノードを削除し、フォーカスから再展開 ────────────
  function cleanUp() {
    const nodes = nodesRef.current
    const edges = edgesRef.current
    const hist  = histRef.current

    // 履歴に含まれないノードを削除
    const toRemove = []
    nodes.forEach((_, id) => {
      if (!hist.includes(id)) toRemove.push(id)
    })
    toRemove.forEach(id => nodes.delete(id))

    // 孤立エッジを削除
    const deadEdges = []
    edges.forEach(key => {
      const [idA, idB] = key.split('|')
      if (!nodes.has(idA) || !nodes.has(idB)) deadEdges.push(key)
    })
    deadEdges.forEach(key => edges.delete(key))

    // フォーカスから再展開
    expandNode(focusRef.current, null)

    setUi(prev => ({ ...prev, nodeCount: nodes.size }))
    reCenter()
  }

  // ── Breadcrumb jump ───────────────────────────────────────────────────────
  function jumpTo(id, sliceEnd) {
    const node = nodesRef.current.get(id)
    if (!node) return
    camRef.current.tx    = node.x
    camRef.current.ty    = node.y
    camRef.current.tzoom = Math.min(camRef.current.zoom, 0.82)
    histRef.current      = histRef.current.slice(0, sliceEnd)
    focusRef.current     = id
    setUi({ focusId: id, history: [...histRef.current], nodeCount: nodesRef.current.size })
    onSelect(node.manga)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const { history, nodeCount } = ui
  const focusNode = nodesRef.current.get(ui.focusId)

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: theme === 'light' ? '#f5f4f0' : '#0d1117',
      animation: 'slideInMap 0.3s cubic-bezier(0.22,0.61,0.36,1)',
      zIndex: 20,
    }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      {(() => {
        const isL = theme === 'light'
        const hBdr  = isL ? '#e5e9f2' : '#1e2535'
        const hBg   = isL ? 'rgba(250,249,245,0.97)' : 'rgba(17,24,39,0.97)'
        const tSub  = isL ? '#6b7280' : '#9ca3af'
        const acc   = isL ? '#6d6af8' : '#818cf8'
        const accBg = isL ? 'rgba(109,106,248,0.08)' : 'rgba(129,140,248,0.10)'
        const btnBg = isL ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)'
        const bStyle = { background: btnBg, border: `1px solid ${hBdr}`, borderRadius: 6, color: tSub, cursor: 'pointer', padding: isMobile ? '4px 8px' : '4px 10px', fontSize: isMobile ? 11 : 12, fontWeight: 600, flexShrink: 0, transition: 'all 0.12s' }
        const iconBtn = { ...bStyle, padding: isMobile ? '4px 8px' : '4px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }
        return (
          <div style={{
            display: 'flex', flexDirection: 'column',
            borderBottom: `1px solid ${hBdr}`,
            background: hBg,
            backdropFilter: 'blur(16px)',
            flexShrink: 0, zIndex: 10,
          }}>

          {isMobile ? (
            <>
            {/* ── モバイル 1行目: 戻る + 検索バー（コンパクト） ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 8px' }}>
              <button onClick={onClose} style={{ ...iconBtn, fontSize: 14, padding: '4px 8px' }}>←</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <SearchBar
                  mangaData={mangaData}
                  onSearch={() => {}}
                  onSelect={item => onRerootSearch && onRerootSearch(item)}
                  variant={theme === 'dark' ? 'dark' : 'light'}
                  compact
                />
              </div>
            </div>

            {/* ── モバイル 2行目: マップ操作 + ナビ ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px 5px' }}>
              <button onClick={cleanUp} title="辿ったパス以外を消去して整理" style={{ ...bStyle, padding: '3px 6px', fontSize: 10 }}>✦整理</button>
              <button onClick={zoomToFit} title="全ノードを表示" style={{ ...bStyle, padding: '3px 6px', fontSize: 10 }}>⊡Fit</button>
              <button onClick={reCenter} title="現在地に戻る" style={{ ...bStyle, padding: '3px 6px', fontSize: 11 }}>◎</button>
              {/* 既読除外 */}
              {onToggleHideViewed && (
                <button onClick={onToggleHideViewed}
                  title={hideViewedMode ? `既読除外中 (${viewedCount}件)` : '既読作品を除外'}
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 10,
                    background: hideViewedMode ? accBg : bStyle.background,
                    borderColor: hideViewedMode ? `${acc}55` : bStyle.borderColor,
                    color: hideViewedMode ? acc : bStyle.color,
                  }}
                >{hideViewedMode ? `👁${viewedCount}` : '👁'}</button>
              )}
              {/* コミュニティ */}
              {onToggleCommunityMode && (
                <button onClick={onToggleCommunityMode}
                  title={communityMode ? 'コミュニティモードON' : 'コミュニティモードOFF'}
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 10,
                    background: communityMode ? accBg : bStyle.background,
                    borderColor: communityMode ? `${acc}55` : bStyle.borderColor,
                    color: communityMode ? acc : bStyle.color,
                  }}
                >{communityMode ? '◉COM' : '◎COM'}</button>
              )}
              <div style={{ flex: 1 }} />
              {/* お気に入り */}
              {onOpenFavorites && (
                <button onClick={onOpenFavorites}
                  title={`お気に入り${favoritesCount > 0 ? ` (${favoritesCount})` : ''}`}
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 10, color: '#f472b6', borderColor: '#f472b644' }}
                >{favoritesCount > 0 ? `♥${favoritesCount}` : '♥'}</button>
              )}
              {/* テーマ */}
              {onToggleTheme && (
                <button onClick={onToggleTheme}
                  title={theme === 'light' ? 'ダークモード' : 'ライトモード'}
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 11 }}
                >{theme === 'light' ? '🌙' : '☀️'}</button>
              )}
              {/* ログイン */}
              {currentUser ? (
                <a href={`/user/${currentUser}`} title="マイページを見る"
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 10, fontWeight: 700, background: accBg, borderColor: `${acc}55`, color: acc, textDecoration: 'none' }}
                >◉{currentUser.slice(0, 4)}</a>
              ) : onLogin && (
                <button onClick={onLogin}
                  style={{ ...bStyle, padding: '3px 6px', fontSize: 10, fontWeight: 700, background: accBg, borderColor: `${acc}55`, color: acc }}
                >ログイン</button>
              )}
            </div>

            {/* ── モバイル: タグセレクター ── */}
            {tagList && tagList.length > 0 && (
              <div style={{ padding: '0 8px 5px' }}>
                <TagSelector tagList={tagList} selectedTags={selectedTags} onToggleTag={onToggleTag} onClearTags={onClearTags} matchCount={tagMatchCount} totalCount={tagTotalCount} variant={theme === 'dark' ? 'dark' : 'light'} filterMode={tagFilterMode} onFilterModeChange={onTagFilterModeChange} />
              </div>
            )}

            {/* ── モバイル 3行目: 作品遷移履歴 ── */}
            {mapHistory.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px 5px', overflowX: 'auto' }}
                onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}
              >
                <button onClick={onMapBack}
                  style={{ flexShrink: 0, padding: '5px 10px', borderRadius: 7, border: `1px solid ${acc}55`, background: accBg, color: acc, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                >← 戻る</button>
                {mapHistory.slice(0, -1).map((item, i, arr) => {
                  const isLatest = i === arr.length - 1
                  return (
                    <button key={`${item.id}-${i}`}
                      onClick={() => onMapHistoryNav && onMapHistoryNav(item, i + 1)}
                      style={{
                        flexShrink: 0, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
                        fontSize: 11, whiteSpace: 'nowrap', fontWeight: isLatest ? 600 : 400,
                        background: isLatest ? accBg : btnBg,
                        border: `1px solid ${isLatest ? acc + '55' : hBdr}`,
                        color: isLatest ? acc : tSub,
                      }}
                    >{item.title_ja || item.title}</button>
                  )
                })}
              </div>
            )}
            </>
          ) : (
            /* ── デスクトップ: 既存の1行ヘッダー ── */
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 12px', height: 44 }}>
              <button onClick={onClose} style={bStyle}>{backLabel ?? '← マップ'}</button>

              <div style={{ flex: 1 }} />

              {/* 注目度フィルター */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 1, background: btnBg, border: `1px solid ${hBdr}`, borderRadius: 6, padding: '2px 5px', flexShrink: 0 }}>
                {[1,2,3,4,5].map(n => {
                  const starColors = isL ? POP_STAR_COLORS_LIGHT : POP_STAR_COLORS
                  const active = n >= minPopularity
                  const col = active ? starColors[n] : (isL ? '#cbd5e1' : '#374151')
                  return (
                    <button key={n} onClick={() => onPopularityChange && onPopularityChange(n === minPopularity ? 1 : n)}
                      title={['','データなし','マイナー','中堅人気','人気作','覇権'][n]}
                      style={{ background: 'none', border: 'none', padding: '1px 2px', cursor: 'pointer', fontSize: 13, color: col, lineHeight: 1, transition: 'color 0.12s' }}
                    >★</button>
                  )
                })}
              </div>

              <button onClick={cleanUp} title="辿ったパス以外を消去して整理" style={bStyle}>✦ 整理</button>
              <button onClick={zoomToFit} title="全ノードを表示" style={bStyle}>⊡ Fit</button>
              <button onClick={reCenter} title="現在地に戻る" style={bStyle}>◎</button>

              {focusNode && (
                <button onClick={() => onSelect(focusNode.manga)} style={{ ...bStyle, background: accBg, border: `1px solid ${acc}55`, color: acc }}>
                  詳細 →
                </button>
              )}
            </div>
          )}

          </div>
        )
      })()}


      {/* ── Canvas ─────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ width:'100%', height:'100%', display:'block', cursor:'grab', touchAction:'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />

        {/* Depth legend */}
        <div style={{
          position:'absolute', bottom: (isMobile ? 12 : 52) + bottomOffset, left: isMobile ? 8 : 14, zIndex:5,
          background: theme === 'light' ? 'rgba(250,249,245,0.94)' : 'rgba(17,24,39,0.92)',
          border: `1px solid ${theme === 'light' ? '#e5e9f2' : '#1e2535'}`,
          borderRadius: isMobile ? 6 : 8, padding: isMobile ? '4px 8px' : '8px 12px',
          display:'flex', flexDirection:'column', gap: isMobile ? 2 : 5,
          boxShadow: theme === 'light' ? '0 2px 12px rgba(0,0,0,0.08)' : '0 2px 16px rgba(0,0,0,0.4)',
          backdropFilter:'blur(12px)',
        }}>
          {[
            { label:'現在地',     op:1.00 },
            { label:'辿ったパス', op:0.68 },
            { label:'隣接作品',   op:0.48 },
            { label:'その他',     op:0.22 },
          ].map(({ label, op }) => (
            <div key={label} style={{ display:'flex', alignItems:'center', gap: isMobile ? 4 : 7 }}>
              <div style={{ width: isMobile ? 6 : 8, height: isMobile ? 6 : 8, borderRadius:'50%', background: theme === 'light' ? '#6d6af8' : '#818cf8', opacity:op, flexShrink:0 }} />
              <span style={{ fontSize: isMobile ? 8 : 10, color: theme === 'light' ? '#6b7280' : '#6b7280' }}>{label}</span>
            </div>
          ))}
        </div>

        {/* 注目度フィルター（モバイル: 右下、深度レジェンドの対面） */}
        {isMobile && (
          <div style={{
            position:'absolute', bottom: 12 + bottomOffset, right:8, zIndex:5,
            background: theme === 'light' ? 'rgba(250,249,245,0.94)' : 'rgba(17,24,39,0.92)',
            border: `1px solid ${theme === 'light' ? '#e5e9f2' : '#1e2535'}`,
            borderRadius:6, padding:'4px 6px',
            display:'flex', flexDirection:'column', gap:2, alignItems:'center',
            boxShadow: theme === 'light' ? '0 2px 12px rgba(0,0,0,0.08)' : '0 2px 16px rgba(0,0,0,0.4)',
            backdropFilter:'blur(12px)',
          }}>
            <div style={{ display:'flex', gap:1, alignItems:'center' }}>
              {[1,2,3,4,5].map(n => {
                const starColors = theme === 'light' ? POP_STAR_COLORS_LIGHT : POP_STAR_COLORS
                const col = n >= minPopularity ? (starColors[n] || '#818cf8') : (theme === 'light' ? '#cbd5e1' : '#374151')
                return (
                  <button key={n} onClick={() => onPopularityChange && onPopularityChange(n === minPopularity ? 1 : n)}
                    title={['','データなし','マイナー','中堅人気','人気作','覇権'][n]}
                    style={{ background:'none', border:'none', padding:'1px', cursor:'pointer', fontSize:12, color:col, lineHeight:1 }}
                  >{n < minPopularity ? '☆' : '★'}</button>
                )
              })}
            </div>
            {minPopularity > 1 && (
              <span style={{ fontSize:8, fontWeight:700, color: (theme === 'light' ? POP_STAR_COLORS_LIGHT : POP_STAR_COLORS)[minPopularity], letterSpacing:'0.04em' }}>
                ★{minPopularity}以上
              </span>
            )}
          </div>
        )}

        {/* Hint bar (desktop only) */}
        {!isMobile && (
          <div style={{
            position:'absolute', bottom: 16 + bottomOffset, left:14,
            background:'rgba(13,17,23,0.75)', border:'1px solid #1e2535',
            borderRadius:6, padding:'4px 10px',
            fontSize:10, color:'#4b5563', pointerEvents:'none',
            display:'flex', gap:10, whiteSpace:'nowrap',
            backdropFilter:'blur(12px)',
          }}>
            <span><span style={{color:'#818cf8'}}>クリック</span> 移動・展開</span>
            <span><span style={{color:'#818cf8'}}>ドラッグ</span> パン</span>
            <span><span style={{color:'#818cf8'}}>スクロール</span> ズーム</span>
            <span><span style={{color:'#818cf8'}}>⊡ Fit</span> 全体表示</span>
          </div>
        )}

        {tooltip && (
          <div style={{
            position:'fixed', left:tooltip.x + 14, top:tooltip.y - 8,
            background:'rgba(17,24,39,0.97)', border:'1px solid #1e2535',
            borderRadius:8, padding:'8px 12px', fontSize:12, color:'#e2e8f0',
            pointerEvents:'none', zIndex:200,
            boxShadow:'0 4px 24px rgba(0,0,0,0.5)',
            backdropFilter:'blur(16px)',
            maxWidth: 260,
          }}>
            {/* タイトル */}
            <div style={{ fontWeight:700, marginBottom: tooltip.commonTags?.length ? 7 : 0 }}>
              {tooltip.title}
            </div>

            {/* 共通タグ＋rank */}
            {tooltip.commonTags?.length > 0 && (
              <>
                <div style={{ fontSize:9, color:'#4b5563', letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:4 }}>
                  共通タグ（フォーカスとの比較）
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                  {tooltip.commonTags.map(t => {
                    const tc = getTagColor(t.name)
                    const avg = Math.round((t.rank + t.rankFocus) / 2)
                    return (
                      <div key={t.name} style={{ display:'flex', alignItems:'center', gap:6 }}>
                        {/* タグ名 */}
                        <span style={{
                          fontSize:9, fontWeight:700, letterSpacing:'0.02em',
                          color:tc, minWidth:70,
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                        }}>
                          {getTagLabel(t.name)}
                        </span>
                        {/* ランクバー */}
                        <div style={{ flex:1, position:'relative', height:5, background:'#1e2535', borderRadius:3, overflow:'hidden' }}>
                          <div style={{
                            position:'absolute', left:0, top:0, height:'100%', borderRadius:3,
                            background:`linear-gradient(to right, ${tc}dd, ${tc}66)`,
                            width:`${avg}%`,
                          }} />
                        </div>
                        {/* 数値（この作品 / フォーカス） */}
                        <span style={{ fontSize:9, color:tc, fontWeight:700, whiteSpace:'nowrap', minWidth:60, textAlign:'right' }}>
                          {t.rank}% / {t.rankFocus}%
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div style={{ fontSize:8, color:'#374151', marginTop:5 }}>
                  左: このノード　右: フォーカス
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

