/**
 * seo.js — SPA用のSEOユーティリティ
 *
 * OGタグ、Twitterカード、canonical、JSON-LDを動的に管理する。
 * プリレンダリングされないSPAルートで使用。
 */

const SITE_URL = 'https://your-domain.com'
const SITE_NAME = 'Media Map'
const DEFAULT_OG_IMAGE = `${SITE_URL}/og-default.png`

// ── meta タグ設定 ─────────────────────────────────────────────────────────────

function setMeta(attr, key, content) {
  let el = document.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function removeMeta(attr, key) {
  const el = document.querySelector(`meta[${attr}="${key}"]`)
  if (el) el.remove()
}

// ── canonical リンク ──────────────────────────────────────────────────────────

function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]')
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', 'canonical')
    document.head.appendChild(el)
  }
  el.setAttribute('href', url)
}

// ── JSON-LD 構造化データ ──────────────────────────────────────────────────────

const JSON_LD_ID = 'seo-json-ld'

function setJsonLd(data) {
  let el = document.getElementById(JSON_LD_ID)
  if (!el) {
    el = document.createElement('script')
    el.id = JSON_LD_ID
    el.type = 'application/ld+json'
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

function removeJsonLd() {
  const el = document.getElementById(JSON_LD_ID)
  if (el) el.remove()
}

// ── 高レベル API ──────────────────────────────────────────────────────────────

/**
 * ページのSEOメタ情報を一括設定
 */
export function updateSeoTags({
  title,
  description,
  url,
  image,
  type = 'website',
  locale = 'ja_JP',
}) {
  // document.title
  if (title) document.title = title

  // meta description
  if (description) setMeta('name', 'description', description)

  // canonical
  const canonicalUrl = url || `${SITE_URL}${window.location.pathname}`
  setCanonical(canonicalUrl)

  // Open Graph
  if (title)       setMeta('property', 'og:title', title)
  if (description) setMeta('property', 'og:description', description)
  setMeta('property', 'og:type', type)
  setMeta('property', 'og:url', canonicalUrl)
  setMeta('property', 'og:locale', locale)
  setMeta('property', 'og:site_name', SITE_NAME)
  setMeta('property', 'og:image', image || DEFAULT_OG_IMAGE)

  // Twitter Card
  setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary')
  if (title)       setMeta('name', 'twitter:title', title)
  if (description) setMeta('name', 'twitter:description', description)
  if (image)       setMeta('name', 'twitter:image', image)
}

/**
 * 作品詳細ページ用のJSON-LDを設定 (Schema.org Book)
 */
export function setMangaJsonLd(manga) {
  if (!manga) { removeJsonLd(); return }

  const data = {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: manga.title_ja || manga.title,
    url: `${SITE_URL}/manga/${manga.slug || manga.id}`,
  }

  if (manga.title && manga.title !== data.name) data.alternateName = manga.title
  if (manga.author)  data.author = { '@type': 'Person', name: manga.author }
  if (manga.genres?.length) data.genre = manga.genres.join(', ')
  if (manga.cover)   data.image = manga.cover
  if (manga.synopsis_ja || manga.synopsis) {
    data.description = (manga.synopsis_ja || manga.synopsis).slice(0, 300)
  }

  setJsonLd(data)
}

/**
 * WebPage用のJSON-LDを設定
 */
export function setWebPageJsonLd({ name, description, url }) {
  setJsonLd({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    description,
    url: url || `${SITE_URL}${window.location.pathname}`,
    isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL },
  })
}

/**
 * コレクション(リスト)ページ用のJSON-LDを設定
 */
export function setCollectionJsonLd({ name, description, url, items }) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: url || `${SITE_URL}${window.location.pathname}`,
  }
  if (description) data.description = description
  if (items?.length) {
    data.mainEntity = {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.slice(0, 20).map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.title_ja || item.title,
      })),
    }
  }
  setJsonLd(data)
}

/**
 * SEOタグのクリーンアップ (ページ遷移時用)
 */
export function cleanupSeoTags() {
  removeJsonLd()
}
