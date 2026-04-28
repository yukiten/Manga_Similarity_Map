// タグ名から一意の色を返す（hex パレットからハッシュで選択）
const TAG_COLOR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#06b6d4','#3b82f6','#8b5cf6','#a855f7','#ec4899',
  '#f43f5e','#84cc16','#10b981','#0ea5e9','#6366f1',
  '#e879f9','#fb923c','#facc15','#4ade80','#34d399',
  '#22d3ee','#60a5fa','#a78bfa','#f472b6','#fb7185',
]
function hashColor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return TAG_COLOR_PALETTE[Math.abs(h) % TAG_COLOR_PALETTE.length]
}

export function getTagColor(tag) {
  const key = (typeof tag === 'object' && tag !== null) ? (tag.name || '').toLowerCase() : (tag || '').toLowerCase()
  const map = {
    action:         '#ef4444',
    adventure:      '#f97316',
    romance:        '#ec4899',
    mystery:        '#8b5cf6',
    'sci-fi':       '#06b6d4',
    fantasy:        '#3b82f6',
    horror:         '#f43f5e',
    comedy:         '#eab308',
    drama:          '#f59e0b',
    sports:         '#22c55e',
    psychological:  '#a855f7',
    supernatural:   '#6366f1',
    'slice-of-life':'#14b8a6',
    school:         '#84cc16',
    historical:     '#d97706',
    mecha:          '#64748b',
    music:          '#e879f9',
    thriller:       '#9f1239',
    'dark comedy':  '#ca8a04',
    superhero:      '#0ea5e9',
    biography:      '#78716c',
  }
  return map[key] || hashColor(key)
}

// 注目度（1-5）を実効値に変換
export function getEffectivePop(m) {
  const raw = m.popularity
  if (!raw || raw <= 1) return (m.score && m.score > 0) ? 2 : 1
  if (raw === 2) return 3
  if (raw === 3) return 4
  return 5
}
