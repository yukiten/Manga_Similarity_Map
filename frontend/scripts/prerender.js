/**
 * prerender.js — vite build 後に実行するプリレンダースクリプト
 *
 * やること:
 *   1. 全作品の dist/manga/:slug/index.html を生成
 *      - <title> / <meta description> / OGP / Twitter Card / keywords を静的埋め込み
 *      - <noscript> に日本語タイトル・著者・ジャンル・タグ・あらすじを埋め込み
 *   2. dist/sitemap.xml を生成
 *   3. dist/robots.txt を生成
 *
 * 使い方:
 *   npm run build:seo                                  # ローカル確認用
 *   SITE_URL=https://your-domain.com npm run build:seo # 本番
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getTagLabel } from '../src/tagTranslations.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT       = path.join(__dirname, '..')
const DIST_DIR   = path.join(ROOT, 'dist')
const PUBLIC_DIR = path.join(ROOT, 'public')

// ── 設定 ──────────────────────────────────────────────────────────────────────
const SITE_URL   = process.env.SITE_URL || 'https://your-domain.com'
const MEDIA_TYPE = 'manga'

// ── ジャンル日本語マップ ───────────────────────────────────────────────────────
const GENRE_JA = {
  action:        'アクション',
  adventure:     '冒険',
  comedy:        'コメディ',
  drama:         'ドラマ',
  fantasy:       'ファンタジー',
  horror:        'ホラー',
  mystery:       'ミステリー',
  romance:       'ロマンス',
  'sci-fi':      'SF',
  'slice of life':'日常',
  sports:        'スポーツ',
  supernatural:  '超自然',
  thriller:      'スリラー',
  psychological: '心理',
  ecchi:         'エッチ',
  hentai:        '成人向け',
  yaoi:          'ボーイズラブ',
  yuri:          '百合',
  isekai:        '異世界',
  mecha:         'メカ',
  music:         '音楽',
  historical:    '歴史',
  school:        '学園',
  martial_arts:  '武術',
  shounen:       '少年',
  shoujo:        '少女',
  seinen:        '青年',
  josei:         '女性',
}

function genreJa(genre) {
  if (!genre) return ''
  return GENRE_JA[genre.toLowerCase()] || genre
}

// ── ユーティリティ ────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function truncate(str, len) {
  if (!str) return ''
  return str.length <= len ? str : str.slice(0, len - 1) + '…'
}

// スポイラーを除いた上位タグを日本語で返す
function topTagsJa(manga, n = 8) {
  return (manga.tags || [])
    .filter(t => !t.spoiler)
    .slice(0, n)
    .map(t => getTagLabel(t.name))
}

// ── メイン ───────────────────────────────────────────────────────────────────
const templatePath = path.join(DIST_DIR, 'index.html')
if (!fs.existsSync(templatePath)) {
  console.error('✗ dist/index.html が見つかりません。先に vite build を実行してください。')
  process.exit(1)
}

const mangaData = JSON.parse(
  fs.readFileSync(path.join(PUBLIC_DIR, `${MEDIA_TYPE}_map.json`), 'utf8')
)
const template = fs.readFileSync(templatePath, 'utf8')

console.log(`📖 ${mangaData.length} 作品をプリレンダーします…`)

const sitemapUrls = [
  { url: `${SITE_URL}/`,              freq: 'monthly' },
  { url: `${SITE_URL}/${MEDIA_TYPE}`, freq: 'weekly'  },
]

let count = 0

for (const manga of mangaData) {
  const slug     = manga.slug || String(manga.id)
  const title    = manga.title_ja || manga.title
  const synopsis = manga.synopsis || ''
  const author   = manga.author || ''
  const genre    = genreJa(manga.genre)
  const tagsJa   = topTagsJa(manga)
  const pageUrl  = `${SITE_URL}/${MEDIA_TYPE}/${slug}`

  // ── description (160字以内) ────────────────────────────────────────────────
  const tagKeywords = tagsJa.slice(0, 4).join('・')
  const authorStr   = author ? `作者: ${author}。` : ''
  const genreStr    = genre  ? `${genre}マンガ。` : ''
  const synopsisStr = truncate(synopsis, 60)

  const description = truncate(
    synopsisStr
      ? `${title} — ${genreStr}${authorStr}${synopsisStr} 類似作品・おすすめをAIが分析。`
      : `${title} — ${genreStr}${authorStr}${tagKeywords}などの要素を持つ類似作品をAIが分析。`,
    160
  )

  // ── keywords (Bing向け、Googleは無視するが害はない) ────────────────────────
  const keywords = [
    title,
    manga.title,                          // 英語タイトルでも検索される
    manga.title_romaji,
    author,
    genre,
    ...tagsJa,
    `${title} 類似作品`,
    `${title} おすすめ`,
    `${title} 似てる`,
    '類似マンガ',
    'マンガ おすすめ',
  ].filter(Boolean).join(', ')

  // ── <head> SEOタグ群 ──────────────────────────────────────────────────────
  const seoTags = [
    `  <title>${escapeHtml(title)} — ${escapeHtml(genre || 'マンガ')}の類似作品 | Media Map</title>`,
    `  <meta name="description" content="${escapeHtml(description)}">`,
    `  <meta name="keywords" content="${escapeHtml(keywords)}">`,
    `  <link rel="canonical" href="${pageUrl}">`,
    `  <meta property="og:type" content="article">`,
    `  <meta property="og:url" content="${pageUrl}">`,
    `  <meta property="og:title" content="${escapeHtml(title)} — 類似作品 | Media Map">`,
    `  <meta property="og:description" content="${escapeHtml(description)}">`,
    `  <meta property="og:locale" content="ja_JP">`,
    manga.cover
      ? `  <meta property="og:image" content="${escapeHtml(manga.cover)}">`
      : '',
    `  <meta name="twitter:card" content="${manga.cover ? 'summary_large_image' : 'summary'}">`,
    `  <meta name="twitter:title" content="${escapeHtml(title)} — 類似作品 | Media Map">`,
    `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
    manga.cover
      ? `  <meta name="twitter:image" content="${escapeHtml(manga.cover)}">`
      : '',
    // JSON-LD 構造化データ
    `  <script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Book',
      name: title,
      alternateName: [manga.title, manga.title_romaji].filter(Boolean),
      author: author ? { '@type': 'Person', name: author } : undefined,
      genre: genre || undefined,
      publisher: manga.publisher ? { '@type': 'Organization', name: manga.publisher } : undefined,
      url: pageUrl,
      image: manga.cover || undefined,
      description: truncate(synopsis, 200) || undefined,
    }, null, 0)}</script>`,
  ].filter(Boolean).join('\n')

  // ── <noscript> — JS無効クローラー向け静的コンテンツ ──────────────────────
  const noscriptLines = [
    `    <noscript>`,
    `      <article>`,
    `        <h1>${escapeHtml(title)}</h1>`,
    manga.title && manga.title !== title
      ? `        <p><b>原題:</b> ${escapeHtml(manga.title)}</p>` : '',
    author  ? `        <p><b>作者:</b> ${escapeHtml(author)}</p>`  : '',
    genre   ? `        <p><b>ジャンル:</b> ${escapeHtml(genre)}</p>` : '',
    manga.year ? `        <p><b>年:</b> ${manga.year}年</p>` : '',
    tagsJa.length
      ? `        <p><b>タグ:</b> ${escapeHtml(tagsJa.join('、'))}</p>` : '',
    synopsis
      ? `        <p>${escapeHtml(truncate(synopsis, 500))}</p>` : '',
    `        <p>${escapeHtml(title)}の類似作品・おすすめマンガをAIが分析します。JavaScriptを有効にするとインタラクティブに探索できます。</p>`,
    `      </article>`,
    `    </noscript>`,
  ].filter(Boolean).join('\n')

  // ── テンプレートに差し込む ────────────────────────────────────────────────
  const html = template
    .replace(/<title>.*?<\/title>/, seoTags)
    .replace('<div id="root"></div>', `<div id="root">\n${noscriptLines}\n  </div>`)

  // ── 出力先は slug ベース ──────────────────────────────────────────────────
  const outDir = path.join(DIST_DIR, MEDIA_TYPE, slug)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8')

  sitemapUrls.push({ url: pageUrl, freq: 'weekly' })
  count++
}

// ── sitemap.xml 生成 ─────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapUrls.map(({ url, freq }) => [
    '  <url>',
    `    <loc>${url}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${freq}</changefreq>`,
    '  </url>',
  ].join('\n')),
  '</urlset>',
].join('\n')
fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8')

// ── robots.txt 生成 ──────────────────────────────────────────────────────────
const robots = [
  'User-agent: *',
  'Allow: /',
  '',
  `Sitemap: ${SITE_URL}/sitemap.xml`,
].join('\n')
fs.writeFileSync(path.join(DIST_DIR, 'robots.txt'), robots, 'utf8')

console.log(`✓ ${count} 作品の HTML を生成しました (URLは /manga/:slug ベース)`)
console.log(`✓ sitemap.xml を生成しました (${sitemapUrls.length} URLs)`)
console.log(`✓ robots.txt を生成しました`)
console.log(`\n本番ドメインを設定する場合:`)
console.log(`  SITE_URL=https://your-domain.com npm run build:seo`)
