/**
 * prerender.js — vite build 後に実行するプリレンダースクリプト
 *
 * やること:
 *   1. 人気上位 TOP_N 作品の dist/manga/:id/index.html を生成
 *      - <title> / <meta description> / OGP / Twitter Card を静的埋め込み
 *      - <noscript> にタイトル + あらすじを埋め込み（JS無効のクローラー対応）
 *   2. dist/sitemap.xml を生成
 *
 * 使い方:
 *   npm run build:seo          # vite build → このスクリプトの順に実行
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT      = path.join(__dirname, '..')
const DIST_DIR  = path.join(ROOT, 'dist')
const PUBLIC_DIR = path.join(ROOT, 'public')

// ── 設定 ──────────────────────────────────────────────────────────────────────
const SITE_URL   = process.env.SITE_URL || 'https://your-domain.com'  // 本番ドメイン
const MEDIA_TYPE = 'manga'      // 現在はマンガのみ

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

const topManga = mangaData

console.log(`📖 ${topManga.length} 作品をプリレンダーします…`)

const sitemapUrls = [
  `${SITE_URL}/`,
  `${SITE_URL}/${MEDIA_TYPE}`,
]

let count = 0

for (const manga of topManga) {
  const title    = manga.title_ja || manga.title
  const synopsis = manga.synopsis || ''
  const pageUrl  = `${SITE_URL}/${MEDIA_TYPE}/${manga.id}`

  // meta description: synopsis の冒頭 + 固定フレーズ
  const descBase  = truncate(synopsis, 80)
  const description = descBase
    ? `${title}の類似作品。${descBase} タグ・類似度で${MEDIA_TYPE === 'manga' ? 'マンガ' : '作品'}を探索。`
    : `${title}の類似作品・おすすめマンガをAIが分析。タグや類似度スコアで探索できます。`

  // ── <head> に挿入する SEO タグ ──────────────────────────────────────────
  const seoTags = [
    `  <title>${escapeHtml(title)} — マンガの類似作品 | Media Map</title>`,
    `  <meta name="description" content="${escapeHtml(truncate(description, 160))}">`,
    `  <link rel="canonical" href="${pageUrl}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:url" content="${pageUrl}">`,
    `  <meta property="og:title" content="${escapeHtml(title)} — 類似作品 | Media Map">`,
    `  <meta property="og:description" content="${escapeHtml(truncate(description, 160))}">`,
    manga.cover
      ? `  <meta property="og:image" content="${escapeHtml(manga.cover)}">`
      : '',
    `  <meta name="twitter:card" content="${manga.cover ? 'summary_large_image' : 'summary'}">`,
    `  <meta name="twitter:title" content="${escapeHtml(title)} — 類似作品 | Media Map">`,
    `  <meta name="twitter:description" content="${escapeHtml(truncate(description, 160))}">`,
    manga.cover
      ? `  <meta name="twitter:image" content="${escapeHtml(manga.cover)}">`
      : '',
  ].filter(Boolean).join('\n')

  // ── <noscript> — JS 無効クローラー向け静的コンテンツ ────────────────────
  const noscriptContent = [
    `    <noscript>`,
    `      <h1>${escapeHtml(title)}</h1>`,
    synopsis ? `      <p>${escapeHtml(truncate(synopsis, 500))}</p>` : '',
    `      <p>JavaScriptを有効にすると、類似作品をインタラクティブに探索できます。</p>`,
    `    </noscript>`,
  ].filter(Boolean).join('\n')

  // ── テンプレートに差し込む ─────────────────────────────────────────────
  const html = template
    // 既存の <title> を SEO タグ群ごと置換
    .replace(/<title>.*?<\/title>/, seoTags)
    // #root に noscript を埋め込む
    .replace('<div id="root"></div>', `<div id="root">\n${noscriptContent}\n  </div>`)

  // ── 出力 ───────────────────────────────────────────────────────────────
  const outDir = path.join(DIST_DIR, MEDIA_TYPE, String(manga.id))
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8')

  sitemapUrls.push(pageUrl)
  count++
}

// ── sitemap.xml 生成 ────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...sitemapUrls.map(url => [
    '  <url>',
    `    <loc>${url}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '  </url>',
  ].join('\n')),
  '</urlset>',
].join('\n')

fs.writeFileSync(path.join(DIST_DIR, 'sitemap.xml'), sitemap, 'utf8')

console.log(`✓ ${count} 作品の HTML を生成しました`)
console.log(`✓ sitemap.xml を生成しました (${sitemapUrls.length} URLs)`)
console.log(`\n⚠️  本番ドメインを設定する場合:`)
console.log(`   SITE_URL=https://your-domain.com npm run build:seo`)
