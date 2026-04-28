import { useRef, useEffect, useMemo, useState, useCallback } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { OrbitControls, Stars, Line, Html } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import * as THREE from 'three'
import { getTagColor, getEffectivePop } from '../utils'
import { getCoverUrl } from '../lib/imageSource'

// ── シェーダー（改良版：core + inner-ring + outer-halo + aGlow） ─────────────

const VERTEX_SHADER = `
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aAlpha;
  attribute float aGlow;
  varying   vec3  vColor;
  varying   float vAlpha;
  varying   float vGlow;

  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vGlow  = aGlow;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp((aSize + aGlow * 0.28) * 300.0 / -mv.z, 1.6, 44.0);
    gl_Position  = projectionMatrix * mv;
  }
`

const FRAGMENT_SHADER = `
  varying vec3  vColor;
  varying float vAlpha;
  varying float vGlow;

  void main() {
    vec2  c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;

    // Solid bright core
    float core = 1.0 - smoothstep(0.0, 0.14, d);
    // Inner ring glow (stronger on selected/neighbor)
    float ring = smoothstep(0.05, 0.12, d) * (1.0 - smoothstep(0.10, 0.22, d));
    // Soft outer halo
    float halo = 1.0 - smoothstep(0.18, 0.50, d);

    float alpha = (core * 0.90 + ring * (0.18 + vGlow * 0.65) + halo * 0.07) * vAlpha;
    vec3  col   = mix(vColor, vec3(1.0), core * 0.22 + ring * vGlow * 0.14);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`

// ── カメラコントローラー ───────────────────────────────────────────────────────

function CameraController({ focusTarget, controlsRef }) {
  const lerpTarget = useRef(new THREE.Vector3())
  const lerpCamera = useRef(null)
  const { camera } = useThree()

  useEffect(() => {
    if (!focusTarget) return
    const newTarget = new THREE.Vector3(focusTarget.x, focusTarget.y, focusTarget.z)
    lerpTarget.current.copy(newTarget)

    if (focusTarget.fitDistance != null) {
      const currentTarget = controlsRef.current?.target ?? new THREE.Vector3()
      const dir = camera.position.clone().sub(currentTarget)
      const len = dir.length()
      if (len > 0) {
        dir.normalize().multiplyScalar(focusTarget.fitDistance)
      } else {
        dir.set(0, 0.3, 1).normalize().multiplyScalar(focusTarget.fitDistance)
      }
      lerpCamera.current = newTarget.clone().add(dir)
    } else {
      if (controlsRef.current) {
        const offset = camera.position.clone().sub(controlsRef.current.target)
        lerpCamera.current = newTarget.clone().add(offset)
      } else {
        lerpCamera.current = new THREE.Vector3(focusTarget.x + 4, focusTarget.y + 2, focusTarget.z + 6)
      }
    }
  }, [focusTarget])

  useFrame(() => {
    if (!lerpCamera.current || !controlsRef.current) return
    controlsRef.current.target.lerp(lerpTarget.current, 0.06)
    camera.position.lerp(lerpCamera.current, 0.05)
    if (camera.position.distanceTo(lerpCamera.current) < 0.4) lerpCamera.current = null
  })
  return null
}

// ── キーボード移動 ─────────────────────────────────────────────────────────────

function KeyboardController({ controlsRef }) {
  const { camera } = useThree()
  const keysRef = useRef({})

  useEffect(() => {
    const onDown = e => { if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') keysRef.current[e.key] = true }
    const onUp   = e => { keysRef.current[e.key] = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup',   onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  useFrame(() => {
    if (!controlsRef.current) return
    const keys = keysRef.current
    const moving = ['w','W','s','S','a','A','d','D','q','Q','e','E','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].some(k => keys[k])
    if (!moving) return
    const dist  = camera.position.distanceTo(controlsRef.current.target)
    const speed = Math.max(0.02, dist * 0.04)
    const fwd   = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0
    if (fwd.lengthSq() < 0.001) fwd.set(0, 0, -1); fwd.normalize()
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0,1,0)).normalize()
    const delta = new THREE.Vector3()
    if (keys['w']||keys['W']||keys['ArrowUp'])    delta.addScaledVector(fwd,   speed)
    if (keys['s']||keys['S']||keys['ArrowDown'])  delta.addScaledVector(fwd,  -speed)
    if (keys['d']||keys['D']||keys['ArrowRight']) delta.addScaledVector(right,  speed)
    if (keys['a']||keys['A']||keys['ArrowLeft'])  delta.addScaledVector(right, -speed)
    if (keys['e']||keys['E']) delta.y += speed
    if (keys['q']||keys['Q']) delta.y -= speed
    camera.position.add(delta)
    controlsRef.current.target.add(delta)
  })
  return null
}

// ── 近傍ライン（アニメーション付き） ─────────────────────────────────────────

function NeighborLine({ start, end, color }) {
  const points = useMemo(() => [new THREE.Vector3(...start), new THREE.Vector3(...end)], [start, end])
  return (
    <Line points={points} color={color} lineWidth={1.2} transparent opacity={0.30} />
  )
}

// ── 作品点群 ──────────────────────────────────────────────────────────────────

function MangaCloud({ mangaData, selected, neighbors, tagScores, onSelect, onHover, actualSelected, theme = 'light' }) {
  const [hoveredIdx, setHoveredIdx] = useState(null)
  const pointerDownPos = useRef(null)
  const count          = mangaData.length
  const { camera, gl } = useThree()
  const isLight = theme === 'light'

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    const pos   = new Float32Array(count * 3)
    const col   = new Float32Array(count * 3)
    const siz   = new Float32Array(count)
    const alpha = new Float32Array(count)
    const glow  = new Float32Array(count)
    const c     = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const m   = mangaData[i]
      pos[i*3]   = m.x; pos[i*3+1] = m.y; pos[i*3+2] = m.z
      siz[i]     = 0.44 + getEffectivePop(m) * 0.2
      alpha[i]   = 1.0
      glow[i]    = 0.0
      c.set(getTagColor(m.genre))
      col[i*3] = c.r; col[i*3+1] = c.g; col[i*3+2] = c.b
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos,   3))
    geo.setAttribute('aColor',   new THREE.BufferAttribute(col,   3))
    geo.setAttribute('aSize',    new THREE.BufferAttribute(siz,   1))
    geo.setAttribute('aAlpha',   new THREE.BufferAttribute(alpha, 1))
    geo.setAttribute('aGlow',    new THREE.BufferAttribute(glow,  1))
    return geo
  }, [mangaData, isLight])

  useEffect(() => {
    if (!geometry) return
    const colorAttr = geometry.getAttribute('aColor')
    const sizeAttr  = geometry.getAttribute('aSize')
    const alphaAttr = geometry.getAttribute('aAlpha')
    const glowAttr  = geometry.getAttribute('aGlow')
    const c = new THREE.Color()
    const neighborIds = new Set((neighbors || []).map(n => n.id))

    for (let i = 0; i < count; i++) {
      const m            = mangaData[i]
      const pop          = getEffectivePop(m)
      const base         = 0.44 + pop * 0.2
      const isSelected   = selected?.id === m.id
      const isNeighbor   = neighborIds.has(m.id)
      const isActualSel  = !isSelected && actualSelected?.id === m.id
      const tagScore     = tagScores ? (tagScores[m.id] ?? 0) : null
      const searching    = tagScore !== null
      const scoreScale   = searching ? (tagScore === 0 ? 0.2 : 0.5 + tagScore * 0.5) : 1.0

      sizeAttr.array[i]  = base * scoreScale * (isSelected ? 3.6 : isActualSel ? 2.9 : isNeighbor ? 2.3 : 1.0)
      alphaAttr.array[i] = searching
        ? (tagScore === 0 ? 0.08 : 0.35 + tagScore * 0.65)
        : (isSelected || isNeighbor || isActualSel ? 1.0 : 0.75)
      glowAttr.array[i]  = isSelected ? 1.0 : isActualSel ? 0.80 : isNeighbor ? 0.50 : 0.0

      c.set(getTagColor(m.genre))
      if (searching && !isSelected && !isNeighbor && !isActualSel) c.multiplyScalar(tagScore === 0 ? 0.1 : 0.4 + tagScore * 0.6)
      if (isSelected)       { c.r = Math.min(1, c.r*2.3); c.g = Math.min(1, c.g*2.3); c.b = Math.min(1, c.b*2.3) }
      else if (isActualSel) { c.r = Math.min(1, c.r*1.9 + 0.12); c.g = Math.min(1, c.g*1.9 + 0.12); c.b = Math.min(1, c.b*1.9 + 0.12) }
      else if (isNeighbor && !searching) { c.r = Math.min(1, c.r*1.7); c.g = Math.min(1, c.g*1.7); c.b = Math.min(1, c.b*1.7) }

      colorAttr.array[i*3] = c.r; colorAttr.array[i*3+1] = c.g; colorAttr.array[i*3+2] = c.b
    }
    colorAttr.needsUpdate = true
    sizeAttr.needsUpdate  = true
    alphaAttr.needsUpdate = true
    glowAttr.needsUpdate  = true
  }, [geometry, mangaData, selected, neighbors, tagScores, count, actualSelected, isLight])

  function pickIdx(intersections, nativeEvent) {
    if (!intersections?.length) return null
    const valid = intersections.filter(h => h.index != null && h.index >= 0 && h.index < count)
    if (!valid.length) return null
    if (valid.length === 1) return valid[0].index
    const rect = gl.domElement.getBoundingClientRect()
    const mx = ((nativeEvent.clientX - rect.left) / rect.width)  * 2 - 1
    const my = -((nativeEvent.clientY - rect.top)  / rect.height) * 2 + 1
    const posAttr = geometry.getAttribute('position')
    const tmp = new THREE.Vector3()
    let best = valid[0].index, bestD = Infinity
    for (const hit of valid) {
      tmp.set(posAttr.getX(hit.index), posAttr.getY(hit.index), posAttr.getZ(hit.index)).project(camera)
      const d = (tmp.x - mx)**2 + (tmp.y - my)**2
      if (d < bestD) { bestD = d; best = hit.index }
    }
    return best
  }

  return (
    <>
      <points
        geometry={geometry}
        onPointerDown={e => { pointerDownPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY } }}
        onClick={e => {
          try {
            if (pointerDownPos.current) {
              const dx = e.nativeEvent.clientX - pointerDownPos.current.x
              const dy = e.nativeEvent.clientY - pointerDownPos.current.y
              if (dx*dx + dy*dy > 25) return
            }
            e.stopPropagation()
            const idx = pickIdx(e.intersections, e.nativeEvent)
            if (idx != null) onSelect(mangaData[idx])
          } catch (_) {}
        }}
        onPointerMove={e => {
          try {
            e.stopPropagation()
            const idx = pickIdx(e.intersections, e.nativeEvent)
            setHoveredIdx(idx ?? null)
            const manga = idx != null ? mangaData[idx] : null
            const isSpecial = manga && (manga.id === selected?.id || (neighbors||[]).some(n=>n.id===manga.id))
            onHover(isSpecial ? null : manga)
            document.body.style.cursor = idx != null ? 'pointer' : 'default'
          } catch (_) {}
        }}
        onPointerLeave={() => { setHoveredIdx(null); onHover(null); document.body.style.cursor = 'default' }}
      >
        <shaderMaterial
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          transparent depthWrite={false}
        />
      </points>
    </>
  )
}

// ── ホバーカード（再設計：カバー画像+グラデーション+スコアバッジ） ──────────

function HoverCard({ manga, tagIdf, theme }) {
  const isLight = theme === 'light'
  const color   = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const url     = getCoverUrl(manga)
  const tags    = (manga.tags || []).filter(t => !t.spoiler).slice(0, 4)
  const score   = manga.score

  const mapWeights = (tagIdf && Object.keys(tagIdf).length > 0)
    ? (() => {
        const scores = tags.map(t => ({ name: t.name, raw: (t.rank / 100) * (tagIdf[t.name] || 1) }))
        const max    = Math.max(...scores.map(s => s.raw), 0.001)
        return Object.fromEntries(scores.map(s => [s.name, Math.round((s.raw / max) * 100)]))
      })()
    : null

  const starColor = score >= 8.5 ? '#fbbf24' : score >= 7.5 ? '#f97316' : score >= 6 ? '#60a5fa' : '#9ca3af'

  return (
    <div style={{
      width: 200,
      background: isLight ? '#faf9f5' : '#08091a',
      border: `1px solid ${isLight ? '#e5e9f2' : color + '38'}`,
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: isLight
        ? '0 14px 36px rgba(15,23,42,0.16)'
        : `0 0 0 1px ${color}18, 0 6px 44px ${color}28, 0 20px 60px rgba(0,0,0,0.95)`,
      fontFamily: 'system-ui, sans-serif',
      userSelect: 'none',
    }}>
      {/* カバー画像＋グラデーションオーバーレイ */}
      <div style={{ position: 'relative', height: 118 }}>
        {url ? (
          <img src={url} alt="" style={{
            width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center top',
            display: 'block',
          }} />
        ) : (
          <div style={{
            width: '100%', height: '100%',
            background: `linear-gradient(135deg, ${color}28, ${color}0c)`,
          }} />
        )}
        {/* グラデーションオーバーレイ */}
        <div style={{
          position: 'absolute', inset: 0,
          background: isLight
            ? 'linear-gradient(to bottom, rgba(250,249,245,0) 35%, rgba(250,249,245,0.97) 100%)'
            : `linear-gradient(to bottom, rgba(8,9,26,0) 25%, rgba(8,9,26,0.97) 100%)`,
        }} />
        {/* タイトル（オーバーレイ内） */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 10px' }}>
          <div style={{
            fontSize: 11.5, fontWeight: 700, lineHeight: 1.35,
            color: isLight ? '#1f2937' : '#eff0ff',
            textShadow: isLight ? 'none' : '0 1px 4px rgba(0,0,0,0.85)',
          }}>
            {manga.title_ja || manga.title}
          </div>
          {manga.title_ja && manga.title_ja !== manga.title && (
            <div style={{
              fontSize: 9, color: isLight ? '#6b7280' : '#5060a0',
              lineHeight: 1.3, marginTop: 1,
            }}>
              {manga.title}
            </div>
          )}
        </div>
        {/* スコアバッジ */}
        {score > 0 && (
          <div style={{
            position: 'absolute', top: 8, right: 8,
            background: isLight ? 'rgba(250,249,245,0.94)' : 'rgba(4,6,18,0.82)',
            borderRadius: 7, padding: '3px 7px',
            display: 'flex', alignItems: 'center', gap: 3,
            backdropFilter: 'blur(10px)',
            border: `1px solid ${starColor}44`,
          }}>
            <span style={{ fontSize: 8.5, color: starColor, lineHeight: 1 }}>★</span>
            <span style={{ fontSize: 11.5, fontWeight: 800, color: starColor, lineHeight: 1 }}>{score.toFixed(1)}</span>
          </div>
        )}
        {/* ジャンル色ライン */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(to right, ${color}cc, ${color}44)`,
        }} />
      </div>

      {/* タグバー */}
      <div style={{ padding: '9px 10px 11px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5.5 }}>
          {tags.map(t => {
            const tc  = getTagColor(t.name)
            const val = mapWeights ? (mapWeights[t.name] ?? t.rank) : t.rank
            return (
              <div key={t.name}>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', marginBottom: 2.5,
                }}>
                  <span style={{
                    fontSize: 8.5, fontWeight: 700, color: tc,
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    {t.name}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, color: tc,
                    textShadow: isLight ? 'none' : `0 0 8px ${tc}55`,
                  }}>
                    {val}%
                  </span>
                </div>
                <div style={{
                  height: 3, borderRadius: 2,
                  background: isLight ? tc + '1e' : tc + '16',
                }}>
                  <div style={{
                    height: '100%', width: `${val}%`, borderRadius: 2,
                    background: isLight
                      ? `linear-gradient(to right, ${tc}cc, ${tc}77)`
                      : `linear-gradient(to right, ${tc}ee, ${tc}77)`,
                    boxShadow: isLight ? 'none' : `0 0 6px ${tc}55`,
                  }} />
                </div>
              </div>
            )
          })}
        </div>
        {mapWeights && (
          <div style={{
            fontSize: 7.5, letterSpacing: '0.06em', marginTop: 5,
            color: isLight ? '#c0c8da' : '#20204a',
            textAlign: 'right',
          }}>
            MAP INFLUENCE
          </div>
        )}
      </div>
    </div>
  )
}

// ── スクリーン座標ヘルパー ────────────────────────────────────────────────────

const _v3 = new THREE.Vector3()

function screenPos(manga, camera, size, dx = 0, dy = -80) {
  _v3.set(manga.x, manga.y, manga.z).project(camera)
  if (_v3.z > 1) return [-9999, -9999]
  const x = (_v3.x *  0.5 + 0.5) * size.width  + dx
  const y = (_v3.y * -0.5 + 0.5) * size.height + dy
  return [
    Math.max(90,  Math.min(size.width  - 90,  x)),
    Math.max(10,  Math.min(size.height - 10,  y)),
  ]
}

// ── 選択ノードのタイトルラベル ────────────────────────────────────────────────

function SelectedLabel({ manga, theme }) {
  const isLight = theme === 'light'
  const color = getTagColor(manga.tags?.[0]?.name || manga.genre)
  return (
    <Html
      position={[manga.x, manga.y, manga.z]}
      center
      style={{ pointerEvents: 'none' }}
      calculatePosition={(el, camera, size) =>
        screenPos(manga, camera, size, 0, -76)
      }
    >
      <div style={{
        background: isLight ? 'rgba(250,249,245,0.97)' : 'rgba(5,6,22,0.94)',
        border: `1.5px solid ${color}${isLight ? '55' : '70'}`,
        borderRadius: 9,
        padding: '6px 14px',
        fontSize: 13,
        fontWeight: 700,
        color: isLight ? '#1f2937' : '#eeeeff',
        whiteSpace: 'nowrap',
        boxShadow: isLight
          ? `0 8px 22px rgba(15,23,42,0.14), 0 0 0 1px ${color}22`
          : `0 0 0 1px ${color}22, 0 0 20px ${color}30, 0 6px 20px rgba(0,0,0,0.85)`,
        fontFamily: 'sans-serif',
        userSelect: 'none',
        letterSpacing: '0.02em',
        backdropFilter: 'blur(14px)',
      }}>
        {manga.title_ja || manga.title}
        <div style={{
          position: 'absolute', bottom: -1, left: '50%', transform: 'translateX(-50%)',
          width: 40, height: 2, borderRadius: 2,
          background: `linear-gradient(to right, transparent, ${color}, transparent)`,
        }} />
      </div>
    </Html>
  )
}

// ── 選択ノードのリング（内側回転＋外側パルス） ──────────────────────────────

function SelectionRing({ manga }) {
  const color    = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const innerRef = useRef()
  const outerRef = useRef()
  const orbitRef = useRef()

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (innerRef.current) innerRef.current.rotation.y = t * 0.60
    if (outerRef.current) {
      outerRef.current.rotation.y = -t * 0.28
      outerRef.current.rotation.z =  t * 0.16
      const pulse = 1 + Math.sin(t * 2.8) * 0.06
      outerRef.current.scale.setScalar(pulse)
      outerRef.current.material.opacity = 0.20 + Math.sin(t * 2.8) * 0.08
    }
    if (orbitRef.current) {
      orbitRef.current.rotation.x = t * 0.45
      orbitRef.current.rotation.z = t * 0.22
    }
  })

  const c = useMemo(() => new THREE.Color(color), [color])

  return (
    <>
      {/* 内側：細いソリッドリング */}
      <mesh ref={innerRef} position={[manga.x, manga.y, manga.z]}>
        <torusGeometry args={[0.058, 0.005, 8, 52]} />
        <meshBasicMaterial color={c} transparent opacity={0.88} depthWrite={false} />
      </mesh>
      {/* 外側：パルスする薄いリング */}
      <mesh ref={outerRef} position={[manga.x, manga.y, manga.z]}>
        <torusGeometry args={[0.100, 0.003, 6, 52]} />
        <meshBasicMaterial color={c} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      {/* 軌道リング：傾いた超薄リング */}
      <mesh ref={orbitRef} position={[manga.x, manga.y, manga.z]}>
        <torusGeometry args={[0.078, 0.002, 6, 48]} />
        <meshBasicMaterial color={c} transparent opacity={0.14} depthWrite={false} />
      </mesh>
    </>
  )
}

// ── ロックモード：DetailPanel 表示中の作品インジケーター ──────────────────────

function ActualSelectionMarker({ manga }) {
  const color = getTagColor(manga.tags?.[0]?.name || manga.genre)

  return (
    <Html
      position={[manga.x, manga.y, manga.z]}
      center
      style={{ pointerEvents: 'none' }}
    >
      <div style={{
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${color} 0%, ${color}99 45%, transparent 100%)`,
        boxShadow: `0 0 8px 3px ${color}88`,
        pointerEvents: 'none',
        animation: 'markerPulse 1.0s ease-in-out infinite',
      }} />
    </Html>
  )
}

// ── 近傍ノードのリング ────────────────────────────────────────────────────────

function NeighborRing({ manga }) {
  const color = getTagColor(manga.tags?.[0]?.name || manga.genre)
  const ref   = useRef()
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.elapsedTime * 0.38
  })
  const c = useMemo(() => new THREE.Color(color), [color])
  return (
    <mesh ref={ref} position={[manga.x, manga.y, manga.z]}>
      <torusGeometry args={[0.22, 0.010, 8, 40]} />
      <meshBasicMaterial color={c} transparent opacity={0.26} depthWrite={false} />
    </mesh>
  )
}

// ── 背景（銀河・星雲改良版） ──────────────────────────────────────────────────

function GalaxyBackground() {
  const nebulaRef = useRef()
  useFrame(({ clock }) => {
    if (nebulaRef.current) nebulaRef.current.rotation.y = clock.elapsedTime * 0.008
  })
  return (
    <group ref={nebulaRef}>
      {/* Core nebula clusters */}
      {[
        [[ 6,  3, -2], '#3a10c0', 22, 0.07],
        [[-7, -4,  6], '#0e0630', 26, 0.09],
        [[ 2,  9,  6], '#080540', 18, 0.065],
        [[-4,  6, -9], '#240658', 20, 0.058],
        [[ 9, -6,  4], '#150430', 24, 0.07],
        [[-2, -9, -4], '#0a1238', 22, 0.060],
        [[ 0,  0,  0], '#06042a', 30, 0.048],
        // Colorful accent wisps
        [[ 4, -2,  8], '#1a0840', 16, 0.09],
        [[-8,  2, -3], '#0c1a3c', 20, 0.07],
        [[ 1,  5, -8], '#200840', 14, 0.085],
        [[-3, -6,  2], '#0d1a20', 18, 0.065],
        [[ 7,  7, -5], '#1c0838', 12, 0.08],
        [[-5,  0,  9], '#100830', 16, 0.07],
      ].map(([pos, col, r, op], i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[r, 12, 12]} />
          <meshBasicMaterial color={col} transparent opacity={op} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      ))}
      <Stars radius={140} depth={90} count={7500} factor={3.5} saturation={0.5} fade speed={0.25} />
      <Stars radius={70}  depth={50} count={1000} factor={7}   saturation={0.7} fade speed={0.18} />
      <Stars radius={30}  depth={20} count={280}  factor={10}  saturation={0.9} fade speed={0.12} />
    </group>
  )
}

// ── ライトモード背景 ──────────────────────────────────────────────────────────

function LightBackground() {
  return (
    <group>
      {[
        [[4, 2, -4], '#eef2ff', 34, 0.14],
        [[-6, -3, 6], '#f3f5ff', 30, 0.12],
        [[0, 7, 2], '#e9edff', 24, 0.12],
        [[0, 0, 0], '#f7f8ff', 42, 0.10],
      ].map(([pos, col, r, op], i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[r, 12, 12]} />
          <meshBasicMaterial color={col} transparent opacity={op} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

// ── シーン ────────────────────────────────────────────────────────────────────

function Scene({ mangaData, selected, neighbors, focusTarget, onSelect, tagScores, onHover, neighborOnlyMode, actualSelected, theme }) {
  const controlsRef = useRef()
  const isLight = theme === 'light'

  return (
    <>
      <fogExp2 attach="fog" args={['#00000a', 0.006]} />

      <GalaxyBackground />
      <CameraController focusTarget={focusTarget} controlsRef={controlsRef} />
      <KeyboardController controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        enableDamping dampingFactor={0.16}
        rotateSpeed={0.6} zoomSpeed={2.6}
        minDistance={0.01} maxDistance={120}
        enablePan screenSpacePanning panSpeed={1.2}
        mouseButtons={{ LEFT: 0, MIDDLE: 2, RIGHT: 1 }}
      />

      <MangaCloud
        mangaData={mangaData}
        selected={selected}
        neighbors={neighbors}
        tagScores={tagScores}
        onSelect={onSelect}
        onHover={onHover}
        actualSelected={actualSelected}
        theme={theme}
      />

      {selected && <SelectionRing manga={selected} />}
      {selected && <SelectedLabel manga={selected} theme={theme} />}

      {actualSelected && actualSelected.id !== selected?.id && (
        <ActualSelectionMarker manga={actualSelected} />
      )}

      {selected && neighbors.map((n, i) => (
        <group key={n.id}>
          {!neighborOnlyMode && <NeighborRing manga={n} />}
          <NeighborLine
            start={[selected.x, selected.y, selected.z]}
            end={[n.x, n.y, n.z]}
            color={isLight ? `hsl(${220 + i * 10}, 82%, 74%)` : `hsl(${200 + i * 28}, 88%, 68%)`}
          />
        </group>
      ))}

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={isLight ? 0.12 : 0.28}
          luminanceThreshold={0.72}
          luminanceSmoothing={0.6}
          radius={0.45}
        />
      </EffectComposer>
    </>
  )
}

// ── エクスポート ──────────────────────────────────────────────────────────────

export default function MangaMap3D({ mangaData, selected, neighbors, focusTarget, onSelect, tagScores, neighborOnlyMode, mapLocked = false, actualSelected = null, tagIdf = {}, theme = 'light' }) {
  const [hoverManga, setHoverManga] = useState(null)
  const cardRef    = useRef()
  const hoverTimer = useRef(null)

  const handleHover = useCallback((manga) => {
    clearTimeout(hoverTimer.current)
    if (!manga) {
      setHoverManga(null)
    } else {
      hoverTimer.current = setTimeout(() => setHoverManga(manga), 140)
    }
  }, [])

  useEffect(() => {
    const CARD_W = 200, CARD_H = 210, OFFSET_X = 22, OFFSET_Y = -16

    function onMove(e) {
      const el = cardRef.current
      if (!el) return
      let x = e.clientX + OFFSET_X
      let y = e.clientY + OFFSET_Y
      if (x + CARD_W > window.innerWidth  - 8) x = e.clientX - CARD_W - 8
      if (y + CARD_H > window.innerHeight - 8) y = e.clientY - CARD_H - 8
      x = Math.max(8, x)
      y = Math.max(8, y)
      el.style.left = x + 'px'
      el.style.top  = y + 'px'
    }

    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', cursor: mapLocked ? 'default' : undefined }}>
      <Canvas
        camera={{ position: [0, 0, 26], fov: 52, near: 0.01, far: 1000 }}
        style={{
          width: '100%', height: '100%',
          background: '#00000a',
          position: 'relative', zIndex: 1,
        }}
        gl={{ antialias: true, alpha: false }}
        raycaster={{ params: { Points: { threshold: 0.45 } } }}
      >
        <Scene
          mangaData={mangaData}
          selected={selected}
          neighbors={neighbors}
          focusTarget={focusTarget}
          onSelect={onSelect}
          tagScores={tagScores}
          onHover={handleHover}
          neighborOnlyMode={neighborOnlyMode}
          actualSelected={actualSelected}
          theme={theme}
        />
      </Canvas>

      {/* ホバーカード */}
      <div
        ref={cardRef}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: 200,
          display: hoverManga ? 'block' : 'none',
          top: 0, left: 0,
          animation: hoverManga ? 'fadeUp 0.15s ease' : 'none',
        }}
      >
        {hoverManga && <HoverCard manga={hoverManga} tagIdf={tagIdf} theme={theme} />}
      </div>

      {/* ロック中インジケーター */}
      {mapLocked && (
        <div style={{
          position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, pointerEvents: 'none',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(251,146,60,0.12)',
          border: '1px solid rgba(251,146,60,0.42)',
          borderRadius: 10, padding: '6px 16px',
          backdropFilter: 'blur(14px)',
          boxShadow: '0 0 20px rgba(251,146,60,0.16)',
        }}>
          <span style={{ fontSize: 12 }}>🔒</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fb923c', letterSpacing: '0.06em' }}>
            近傍マップ固定中
          </span>
        </div>
      )}
    </div>
  )
}
