// タグ名から一意の色を返す（hex パレットからハッシュで選択）
// ライト・ダーク両モードで十分なコントラストが出るよう 600 番台を基準にしている
const TAG_COLOR_PALETTE = [
  '#dc2626','#ea580c','#ca8a04','#16a34a','#0d9488',
  '#0891b2','#2563eb','#7c3aed','#9333ea','#db2777',
  '#e11d48','#65a30d','#059669','#0284c7','#4f46e5',
  '#c026d3','#f97316','#d97706','#15803d','#0f766e',
  '#0e7490','#1d4ed8','#6d28d9','#be185d','#be123c',
]
function hashColor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return TAG_COLOR_PALETTE[Math.abs(h) % TAG_COLOR_PALETTE.length]
}

function hashInt(str) {
  // FNV-1a 32bit（JS で安定・高速）
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h | 0
}

function hslToHex(h, s, l) {
  // h: 0-360, s/l: 0-100
  const hh = ((h % 360) + 360) % 360
  const ss = Math.max(0, Math.min(100, s)) / 100
  const ll = Math.max(0, Math.min(100, l)) / 100

  const c = (1 - Math.abs(2 * ll - 1)) * ss
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1))
  const m = ll - c / 2

  let r = 0, g = 0, b = 0
  if (hh < 60)      { r = c; g = x; b = 0 }
  else if (hh < 120){ r = x; g = c; b = 0 }
  else if (hh < 180){ r = 0; g = c; b = x }
  else if (hh < 240){ r = 0; g = x; b = c }
  else if (hh < 300){ r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }

  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hashVividColor(str, theme = 'light') {
  // 色相を広く散らばらせて、タグの見分けを良くする（hex を返す）
  // golden angle で分散 + 黄系は知覚輝度が高いため追加補正
  // theme により明度を大きく分ける：
  // - light: 暗め（白背景でのテキストコントラスト確保）→ 28〜38%
  // - dark:  明るめ（暗背景でのテキストコントラスト確保）→ 68〜78%
  const u = (hashInt(str) >>> 0)
  const hue = (u * 137.508) % 360
  const sat = 80 + (u % 14) // 80-93

  const isDark = theme === 'dark'
  // base: light=28-38, dark=68-78
  let light = (isDark ? 68 : 28) + ((u >>> 8) % 10)
  // 黄・黄緑系（hue 45-90）は知覚輝度が高いので追加補正
  if (hue > 45 && hue < 90) {
    light = isDark
      ? Math.min(light - 6, 72)   // ダーク: やや暗くして彩度を保つ
      : Math.max(light - 5, 23)   // ライト: さらに暗く
  }
  return hslToHex(hue, sat, light)
}

export function getTagColor(tag) {
  const key = (typeof tag === 'object' && tag !== null) ? (tag.name || '').toLowerCase() : (tag || '').toLowerCase()
  const map = {
    action:         '#dc2626',  // red-600
    adventure:      '#ea580c',  // orange-600
    romance:        '#db2777',  // pink-600
    mystery:        '#7c3aed',  // violet-600
    'sci-fi':       '#0891b2',  // cyan-600
    fantasy:        '#2563eb',  // blue-600
    horror:         '#e11d48',  // rose-600
    comedy:         '#ca8a04',  // yellow-600
    drama:          '#d97706',  // amber-600
    sports:         '#16a34a',  // green-600
    psychological:  '#9333ea',  // purple-600
    supernatural:   '#4f46e5',  // indigo-600
    'slice-of-life':'#0d9488',  // teal-600
    school:         '#65a30d',  // lime-600
    historical:     '#b45309',  // amber-700
    mecha:          '#475569',  // slate-600
    music:          '#c026d3',  // fuchsia-600
    thriller:       '#9f1239',  // rose-800
    'dark comedy':  '#a16207',  // yellow-700
    superhero:      '#0284c7',  // sky-600
    biography:      '#57534e',  // stone-600
  }
  return map[key] || hashColor(key)
}

// 作品詳細タブ向け：タグをよりカラフルに見分けやすくする
// テーマ別に明度を調整してコントラストを確保する
export function getTagColorVivid(tag, theme = 'light') {
  const key = (typeof tag === 'object' && tag !== null) ? (tag.name || '').toLowerCase() : (tag || '').toLowerCase()
  const isDark = theme === 'dark'

  // light: Tailwind 700〜800 相当（白背景で視認性高め）
  // dark : Tailwind 300〜400 相当（暗背景で視認性高め）
  const map = isDark ? {
    action:         '#f87171',  // red-400
    adventure:      '#fb923c',  // orange-400
    romance:        '#f472b6',  // pink-400
    mystery:        '#a78bfa',  // violet-400
    'sci-fi':       '#22d3ee',  // cyan-400
    fantasy:        '#60a5fa',  // blue-400
    horror:         '#fb7185',  // rose-400
    comedy:         '#facc15',  // yellow-400
    drama:          '#fbbf24',  // amber-400
    sports:         '#4ade80',  // green-400
    psychological:  '#c084fc',  // purple-400
    supernatural:   '#818cf8',  // indigo-400
    'slice-of-life':'#2dd4bf',  // teal-400
    school:         '#a3e635',  // lime-400
    historical:     '#fcd34d',  // amber-300
    mecha:          '#94a3b8',  // slate-400
    music:          '#e879f9',  // fuchsia-400
    thriller:       '#fca5a5',  // red-300
    'dark comedy':  '#fde047',  // yellow-300
    superhero:      '#38bdf8',  // sky-400
    biography:      '#a8a29e',  // stone-400
  } : {
    action:         '#b91c1c',  // red-700
    adventure:      '#c2410c',  // orange-700
    romance:        '#be185d',  // pink-700
    mystery:        '#6d28d9',  // violet-700
    'sci-fi':       '#0e7490',  // cyan-700
    fantasy:        '#1d4ed8',  // blue-700
    horror:         '#be123c',  // rose-700
    comedy:         '#a16207',  // yellow-700
    drama:          '#b45309',  // amber-700
    sports:         '#15803d',  // green-700
    psychological:  '#7e22ce',  // purple-700
    supernatural:   '#4338ca',  // indigo-700
    'slice-of-life':'#0f766e',  // teal-700
    school:         '#4d7c0f',  // lime-700
    historical:     '#92400e',  // amber-800
    mecha:          '#334155',  // slate-700
    music:          '#a21caf',  // fuchsia-700
    thriller:       '#881337',  // rose-800
    'dark comedy':  '#854d0e',  // yellow-800
    superhero:      '#0369a1',  // sky-700
    biography:      '#44403c',  // stone-700
  }
  return map[key] || hashVividColor(key, theme)
}

// 注目度（1-5）を実効値に変換
export function getEffectivePop(m) {
  const raw = m.popularity
  if (!raw || raw <= 1) return (m.score && m.score > 0) ? 2 : 1
  if (raw === 2) return 3
  if (raw === 3) return 4
  return 5
}
