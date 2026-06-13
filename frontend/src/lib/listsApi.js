// ── 作品リスト API ──────────────────────────────────────────────────────────

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'APIエラー')
  }
  return res.json()
}

// 自分のリスト一覧（非公開含む）
export function fetchMyLists(token) {
  return apiFetch('/api/user/lists', { headers: authHeaders(token) })
}

// リスト作成
export function createList(token, { name, description = '', is_public = true }) {
  return apiFetch('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ name, description, is_public }),
  })
}

// リスト更新（名前・説明・公開設定）
export function updateList(token, listId, patch) {
  return apiFetch(`/api/lists/${listId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(patch),
  })
}

// リスト削除
export function deleteList(token, listId) {
  return apiFetch(`/api/lists/${listId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

// リスト詳細取得
export function fetchList(listId, token) {
  return apiFetch(`/api/lists/${listId}`, { headers: authHeaders(token) })
}

// リスト内作品一覧
export function fetchListItems(listId, token) {
  return apiFetch(`/api/lists/${listId}/items`, { headers: authHeaders(token) })
}

// 作品をリストに追加
export function addToList(token, listId, mangaId, note = '') {
  return apiFetch(`/api/lists/${listId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ manga_id: mangaId, note }),
  })
}

// 作品をリストから削除
export function removeFromList(token, listId, mangaId) {
  return apiFetch(`/api/lists/${listId}/items/${mangaId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  })
}

// 他ユーザーの公開リスト一覧
export function fetchUserLists(username) {
  return apiFetch(`/api/users/${encodeURIComponent(username)}/lists`)
}

// この作品を含む公開リスト一覧
export function fetchMangaLists(mangaId) {
  return apiFetch(`/api/manga/${mangaId}/lists`)
}
