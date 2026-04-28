import { useRef, useState, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { getTagColor, getEffectivePop } from '../utils'

export default function MangaNode({ manga, isSelected, isNeighbor, onClick, tagScore }) {
  const meshRef = useRef()
  const glowRef = useRef()
  const [hovered, setHovered] = useState(false)
  const [nearCamera, setNearCamera] = useState(false)
  const nearRef = useRef(false)
  const { camera } = useThree()

  // tags は {name, rank, spoiler} オブジェクトの配列
  const primaryTag = manga.tags?.[0]?.name || manga.genre || 'action'
  const color = getTagColor(primaryTag)

  // tagScore: null=検索なし, 0=非該当, 0-1=スコア
  const searching    = tagScore !== null
  const scoreOpacity = searching ? (tagScore === 0 ? 0.07 : 0.25 + tagScore * 0.75) : 1.0
  const scoreScale   = searching ? (tagScore === 0 ? 0.5  : 0.8  + tagScore * 0.2)  : 1.0

  const pop = getEffectivePop(manga)

  // Node radius scales with popularity (pop5 = 0.22, pop1 = 0.08)
  const baseRadius = useMemo(() => 0.06 + pop * 0.032, [pop])

  // Label appears when camera is within this distance
  // Popular nodes glow from further away (like bright stars)
  const labelDistance = 6 + pop * 2.2   // pop5 ≈ 17, pop1 ≈ 8

  const nodePos = useMemo(
    () => new THREE.Vector3(manga.x, manga.y, manga.z),
    [manga.x, manga.y, manga.z]
  )

  useFrame((state) => {
    if (!meshRef.current) return

    // Scale animation
    const base = scoreScale
    if (isSelected) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.1
      meshRef.current.scale.setScalar(pulse * 1.5 * base)
    } else if (isNeighbor) {
      meshRef.current.scale.setScalar(1.2 * base)
    } else if (hovered) {
      meshRef.current.scale.setScalar(1.3 * base)
    } else {
      meshRef.current.scale.setScalar(base)
    }

    // Core mesh opacity
    if (meshRef.current.material) {
      meshRef.current.material.opacity = scoreOpacity
    }

    // Glow halo breathes gently
    if (glowRef.current) {
      const breath = 0.9 + Math.sin(state.clock.elapsedTime * 1.5 + manga.x) * 0.1
      glowRef.current.scale.setScalar(isSelected ? 2.2 * breath : 2.0)
      const mat = glowRef.current.material
      const baseGlow = isSelected ? 0.18 * breath : isNeighbor ? 0.10 : hovered ? 0.09 : 0.03 + (pop * 0.008)
      mat.opacity = baseGlow * scoreOpacity
    }

    // LOD: detect when camera is close enough to show label
    const dist = camera.position.distanceTo(nodePos)
    const isNear = dist < labelDistance
    if (isNear !== nearRef.current) {
      nearRef.current = isNear
      setNearCamera(isNear)
    }
  })

  const showLabel = hovered || isSelected || isNeighbor || nearCamera

  return (
    <group position={[manga.x, manga.y, manga.z]}>
      {/* Soft glow halo — like a star corona */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[baseRadius * 2.0, 10, 10]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.03}
          depthWrite={false}
        />
      </mesh>

      {/* Core node */}
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer' }}
        onPointerLeave={(e) => { e.stopPropagation(); setHovered(false); document.body.style.cursor = 'default' }}
      >
        <sphereGeometry args={[baseRadius, 18, 18]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={
            isSelected ? 3.0 :
            isNeighbor ? 1.4 :
            hovered    ? 1.2 :
            searching  ? (tagScore === 0 ? 0.05 : 0.5 + tagScore * 2.5) :
                         0.3 + pop * 0.1
          }
          roughness={0.2}
          metalness={0.5}
          transparent
          opacity={scoreOpacity}
        />
      </mesh>

      {/* LOD label: visible only when zoomed in close enough */}
      {showLabel && (
        <Html
          distanceFactor={10}
          position={[0, baseRadius + 0.18, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div className="node-label" style={{
            border: `1px solid ${color}66`,
            color: isSelected ? color : '#e8e8f0',
            fontWeight: isSelected ? 700 : 500,
            fontSize: isSelected ? 13 : pop >= 4 ? 12 : 10,
            opacity: nearCamera && !isSelected && !isNeighbor && !hovered ? 0.7 : 1,
          }}>
            {manga.title}
          </div>
        </Html>
      )}
    </group>
  )
}
