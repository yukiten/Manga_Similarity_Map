// ── Queue-based image loader with concurrency throttling ─────────────────────
//
// CDN への同時リクエスト数を MAX_CONCURRENT に制限し、大量リクエストを防ぐ。
// モジュールレベルのシングルトン = コンポーネントの再マウントをまたいでキャッシュが
// 生きるため、同じ画像を何度もリクエストしない。
//
// ─────────────────────────────────────────────────────────────────────────────

/** CDN に同時に投げる最大リクエスト数（ブラウザ上限 & CDN 負荷を考慮） */
const MAX_CONCURRENT = 4

/** キューに積める最大件数（これを超えた新規リクエストは破棄） */
const MAX_QUEUE_SIZE = 32

/** id → HTMLImageElement | 'queued' | 'loading' | 'error' */
const cache  = new Map()

/** 待機中の { id, url } */
const queue  = []

/** 現在飛んでいるリクエスト数 */
let   active = 0

// ─────────────────────────────────────────────────────────────────────────────

function pump() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const { id, url } = queue.shift()

    // 'queued' 以外になっていたらスキップ（キャンセル等）
    if (cache.get(id) !== 'queued') continue

    active++
    cache.set(id, 'loading')

    const img = new Image()

    img.onload = () => {
      cache.set(id, img)
      active--
      pump()
    }
    img.onerror = () => {
      cache.set(id, 'error')
      active--
      pump()
    }

    img.src = url
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * 画像のロードをリクエストする。
 * 冪等（何度呼んでも安全）— 既にキャッシュ済みの id は即リターン。
 * 描画ループから毎フレーム呼ばれることを想定している。
 *
 * @param {string} id  - manga の一意 ID
 * @param {string} url - 画像 URL
 */
export function requestImage(id, url) {
  if (!id || !url || cache.has(id)) return
  if (queue.length >= MAX_QUEUE_SIZE) return   // キューが満杯なら破棄
  cache.set(id, 'queued')
  queue.push({ id, url })
  pump()
}

/**
 * 待機中のキューをフラッシュする（キャッシュ済み画像は保持）。
 * ルートマンガが切り替わったとき等、古い pending を捨てたい場合に呼ぶ。
 */
export function flushQueue() {
  // 'queued' 状態のエントリをキャッシュから削除してキューも空にする
  queue.forEach(({ id }) => {
    if (cache.get(id) === 'queued') cache.delete(id)
  })
  queue.length = 0
}

/**
 * ロード済みの HTMLImageElement を返す。
 * まだ準備できていない場合は null。
 *
 * @param {string} id
 * @returns {HTMLImageElement|null}
 */
export function getImage(id) {
  const v = cache.get(id)
  return v instanceof HTMLImageElement ? v : null
}

/**
 * キャッシュの生の状態を返す。
 * undefined | 'queued' | 'loading' | 'error' | HTMLImageElement
 */
export function getImageState(id) {
  return cache.get(id)
}

/**
 * キャッシュと待機キューをクリアする。
 * 配信元（SOURCE）を切り替えた時などに呼ぶ。
 * ※ 既に飛んでいるリクエストは完了するが結果は無視される。
 */
export function clearImageCache() {
  cache.clear()
  queue.length = 0
}
