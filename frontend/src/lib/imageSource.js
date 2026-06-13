// ── Image source configuration ────────────────────────────────────────────────
//
// ここを変更するだけで画像配信元を切り替えられます。
//
//   'anilist' : manga_map.json に埋め込まれた AniList CDN URL をそのまま使用
//               （デフォルト / 開発・個人利用向け）
//
//   'local'   : /public/covers/{id}.jpg を参照
//               事前ダウンロードして自前でホスティングする場合
//               例: python scripts/download_covers.py
//
//   'custom'  : 任意のエンドポイント（自前 CDN / バックエンド API）
//               CUSTOM_BASE_URL を書き換えてください
//
// ─────────────────────────────────────────────────────────────────────────────
const SOURCE = 'anilist'

const CUSTOM_BASE_URL = 'https://your-cdn.example.com/covers'

// ─────────────────────────────────────────────────────────────────────────────

/**
 * manga の楽天アフィリエイト URL を返す。なければ null。
 * 楽天データ取得済みの作品のみ非 null になる。
 *
 * @param {object} manga
 * @returns {string|null}
 */
export function getAffiliateUrl(manga) {
  return manga?.affiliate_url || null
}

/**
 * manga オブジェクトからカバー画像の URL を返す。
 * SOURCE を切り替えるだけで配信元を変更できる。
 *
 * @param {object} manga - manga_map.json の1エントリ
 * @returns {string|null}
 */
export function getCoverUrl(manga) {
  if (!manga) return null

  switch (SOURCE) {
    case 'local':
      return `/covers/${manga.id}.jpg`

    case 'custom':
      return `${CUSTOM_BASE_URL}/${manga.id}.jpg`

    case 'anilist':
    default:
      // AniList カバーを優先、なければ楽天画像にフォールバック
      return manga.cover || manga.image_url || null
  }
}
