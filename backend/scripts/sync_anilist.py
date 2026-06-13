import os
"""
AniList 差分同期スクリプト
==========================
前回同期以降に AniList で更新された日本語マンガを取得し、
未登録の作品を類似マップに追加する。

処理フロー:
  1. AniList GraphQL で updatedAt > 前回同期時刻 のマンガを取得
  2. country=JP / title_ja あり / 未登録 に絞り込み
  3. 保存済み UMAP モデルで 3D 座標を近似推定
  4. 既存座標との kNN で neighbors を計算
  5. merged.json / manga_map.json を更新
  6. PostgreSQL に UPSERT
  7. バックエンドキャッシュを無効化
  8. 次回同期用に .last_sync を更新

使い方:
    python backend/scripts/sync_anilist.py
    python backend/scripts/sync_anilist.py --dry-run
    python backend/scripts/sync_anilist.py --days 7     # 過去7日分を強制取得
    python backend/scripts/sync_anilist.py --limit 200  # 追加上限200件

事前条件:
    generate_embeddings.py を一度実行済みであること
    （backend/data/model/ にモデルファイルが必要）
"""

import argparse
import json
import math
import pickle
import random
import re
import shutil
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

try:
    import requests
except ImportError:
    print("requests が必要です: pip install requests")
    sys.exit(1)

# ── パス定数 ─────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
BACKEND_DIR  = SCRIPT_DIR.parent
BASE_DIR     = BACKEND_DIR.parent

MERGED_FILE  = BACKEND_DIR / "data" / "merged.json"
MAP_FILE     = BASE_DIR / "frontend" / "public" / "manga_map.json"
OUTPUT_MAP   = BACKEND_DIR / "output" / "manga_map.json"
MODEL_DIR    = BACKEND_DIR / "data" / "model"
SYNC_STATE   = BACKEND_DIR / "data" / ".last_sync"   # 前回同期の Unix 時刻

DEFAULT_DB_URL  = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")
ANILIST_URL     = "https://graphql.anilist.co"
PER_PAGE        = 50
RATE_LIMIT_WAIT = (1.0, 3.0)   # リクエスト間隔（秒）
RETRY_WAIT      = 65            # 429 時の待機秒数
MAX_RETRIES     = 3

# ── AniList GraphQL クエリ ───────────────────────────────────────────────────

QUERY = """
query ($page: Int, $perPage: Int, $since: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage currentPage lastPage }
    media(
      type: MANGA
      countryOfOrigin: JP
      isAdult: false
      sort: [UPDATED_AT_DESC]
      updatedAt_greater: $since
    ) {
      id
      updatedAt
      title { romaji english native }
      synonyms
      description(asHtml: false)
      genres
      tags { name rank isMediaSpoiler }
      averageScore
      meanScore
      popularity
      favourites
      status
      format
      source
      countryOfOrigin
      isAdult
      chapters
      volumes
      startDate { year }
      coverImage { extraLarge large color }
      siteUrl
    }
  }
}
"""

# ── ヘルパー ─────────────────────────────────────────────────────────────────

def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

def load_sync_state() -> int:
    """前回同期の Unix タイムスタンプを返す（なければ 30 日前）"""
    if SYNC_STATE.exists():
        try:
            return int(SYNC_STATE.read_text().strip())
        except Exception:
            pass
    return int(time.time()) - 60 * 60 * 24 * 30   # 30 日前

def save_sync_state(ts: int):
    SYNC_STATE.write_text(str(ts))

def calc_attention(popularity: int) -> int:
    if popularity >= 200_000: return 5
    if popularity >= 60_000:  return 4
    if popularity >= 15_000:  return 3
    if popularity >= 3_000:   return 2
    return 1

def make_slug(title_romaji: str, manga_id: str, existing_slugs: set) -> str:
    base = re.sub(r"[^\w\s-]", "", (title_romaji or "").lower())
    base = re.sub(r"[\s_]+", "-", base).strip("-") or f"manga-{manga_id}"
    slug = base
    if slug in existing_slugs:
        slug = f"{base}-{manga_id}"
    return slug

def convert(media: dict) -> dict:
    """AniList レスポンスを内部フォーマットに変換"""
    titles   = media.get("title") or {}
    title    = (titles.get("english") or titles.get("romaji") or titles.get("native") or "Unknown")
    title_ja = titles.get("native") or ""
    romaji   = titles.get("romaji") or ""

    synopsis = (media.get("description") or "").replace("\n", " ").replace("<br>", " ").strip()
    if len(synopsis) > 600:
        synopsis = synopsis[:597] + "…"

    genres   = media.get("genres") or []
    tags_raw = sorted(media.get("tags") or [], key=lambda t: t.get("rank", 0), reverse=True)
    tags = [
        {"name": t["name"], "rank": t.get("rank", 0), "spoiler": t.get("isMediaSpoiler", False)}
        for t in tags_raw
    ]

    popularity_raw = media.get("popularity") or 0
    avg_score      = media.get("averageScore")
    cover          = media.get("coverImage") or {}
    year           = (media.get("startDate") or {}).get("year")

    return {
        "id":           str(media["id"]),
        "title":        title,
        "title_ja":     title_ja,
        "title_romaji": romaji,
        "synopsis":     synopsis,
        "genres":       genres,
        "tags":         tags,
        "genre":        genres[0].lower() if genres else "unknown",
        "source":       media.get("source", ""),
        "country":      media.get("countryOfOrigin", "JP"),
        "is_adult":     media.get("isAdult", False),
        "popularity":   calc_attention(popularity_raw),
        "score":        avg_score,
        "year":         year,
        "cover":        cover.get("extraLarge") or cover.get("large") or "",
        "cover_xl":     cover.get("extraLarge") or "",
        "url":          media.get("siteUrl") or "",
        "_sources":     ["anilist"],
    }

# ── AniList フェッチ ──────────────────────────────────────────────────────────

def fetch_page(page: int, since: int, session: requests.Session) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            resp = session.post(
                ANILIST_URL,
                json={"query": QUERY, "variables": {"page": page, "perPage": PER_PAGE, "since": since}},
                timeout=30,
            )
            if resp.status_code == 429:
                print(f"  レートリミット(429) → {RETRY_WAIT}秒待機...")
                time.sleep(RETRY_WAIT)
                continue
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = (attempt + 1) * 10
            print(f"  エラー({e})、{wait}秒後に再試行...")
            time.sleep(wait)
    raise RuntimeError("フェッチ失敗")

def fetch_updated_manga(since: int, limit: int) -> list[dict]:
    """since より新しく更新された JP マンガを取得"""
    session  = requests.Session()
    session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})

    results  = []
    page     = 1
    stopped  = False

    while not stopped:
        print(f"  page {page} 取得中 (since={since})...")
        data = fetch_page(page, since, session)
        page_info = data["data"]["Page"]["pageInfo"]
        items     = data["data"]["Page"]["media"]

        if not items:
            break

        for item in items:
            # updatedAt が since 以下なら以降のページも古いので停止
            if item.get("updatedAt", 0) <= since:
                stopped = True
                break
            converted = convert(item)
            # JP 作品 + title_ja あり のみ対象
            if converted["country"] == "JP" and converted["title_ja"]:
                results.append(converted)

        print(f"    → {len(items)} 件取得, 累計候補 {len(results)} 件")

        if not page_info.get("hasNextPage") or stopped or len(results) >= limit:
            break

        page += 1
        time.sleep(random.uniform(*RATE_LIMIT_WAIT))

    return results[:limit]

# ── モデル読み込み ────────────────────────────────────────────────────────────

def load_model_artifacts():
    """UMAP モデル・正規化パラメータ・語彙・座標を読み込む"""
    required = ["umap_model.pkl", "norm_params.json", "tag_vocab.json", "coords.npy", "manga_ids.json"]
    missing  = [f for f in required if not (MODEL_DIR / f).exists()]
    if missing:
        print(f"\nエラー: モデルファイルが見つかりません: {missing}")
        print("  先に generate_embeddings.py を実行してください。")
        sys.exit(1)

    import numpy as np

    with open(MODEL_DIR / "umap_model.pkl", "rb") as f:
        reducer = pickle.load(f)

    norm_params = load_json(MODEL_DIR / "norm_params.json")
    tag_vocab   = load_json(MODEL_DIR / "tag_vocab.json")
    coords      = np.load(MODEL_DIR / "coords.npy")
    manga_ids   = load_json(MODEL_DIR / "manga_ids.json")

    tag_idf     = load_json(BASE_DIR / "frontend" / "public" / "tag_idf.json")

    print(f"  モデル読み込み完了: {len(manga_ids)} 件, {len(tag_vocab)} タグ")
    return reducer, norm_params, tag_vocab, tag_idf, coords, manga_ids

# ── 埋め込み推定 ─────────────────────────────────────────────────────────────

def infer_coords(new_manga: list[dict], reducer, norm_params: list, tag_vocab: list, tag_idf: dict):
    """新規マンガのタグベクトルを構築し UMAP で座標を推定する"""
    import numpy as np
    import scipy.sparse as sp

    tag_to_idx  = {t: i for i, t in enumerate(tag_vocab)}
    V           = len(tag_vocab)
    N           = len(new_manga)
    # IDF にないタグのデフォルト IDF: log(全データ数) ≈ レアタグ扱い
    default_idf = math.log(max(len(tag_idf), 1))
    rows, cols, data = [], [], []

    for i, manga in enumerate(new_manga):
        for tag in manga.get("tags", []):
            if not isinstance(tag, dict) or tag.get("spoiler", False):
                continue
            name = tag.get("name", "")
            idx  = tag_to_idx.get(name)
            if idx is None:
                continue   # 未知タグはスキップ
            idf = tag_idf.get(name, default_idf)
            w   = (tag.get("rank", 0) / 100.0) * idf
            if w > 0:
                rows.append(i); cols.append(idx); data.append(w)

    mat = sp.csr_matrix((data, (rows, cols)), shape=(N, V), dtype=np.float32)

    print(f"  {N} 件のタグ行列構築完了 (nnz={mat.nnz})")
    print("  UMAP transform 実行中...")

    try:
        raw = reducer.transform(mat)
    except Exception as e:
        print(f"  ⚠ transform 失敗 ({e}) → ゼロ座標にフォールバック")
        raw = np.zeros((N, 3), dtype=np.float32)

    # 学習時と同じ正規化を適用
    normalized = raw.copy()
    for axis in range(3):
        p = norm_params[axis]
        if p["range"] > 0:
            normalized[:, axis] = (raw[:, axis] - p["min"]) / p["range"] * 10 - 5
        # 範囲外はクリップ（マップ端に押し付ける）
        normalized[:, axis] = np.clip(normalized[:, axis], -5.5, 5.5)

    return normalized

# ── neighbors 計算 ───────────────────────────────────────────────────────────

def compute_neighbors(new_coords, new_ids: list, existing_coords, existing_ids: list, k: int = 12):
    """新規点それぞれについて既存座標から k 近傍を求める"""
    from sklearn.neighbors import NearestNeighbors
    import numpy as np

    # 既存 + 新規を合わせた全座標でインデックスを構築
    all_coords = np.vstack([existing_coords, new_coords])
    all_ids    = existing_ids + new_ids

    knn = NearestNeighbors(n_neighbors=min(k + 1, len(all_ids)), metric="euclidean", algorithm="auto")
    knn.fit(all_coords)

    # 新規点のみクエリ（既存はそのまま）
    new_start = len(existing_coords)
    _, indices = knn.kneighbors(all_coords[new_start:])

    neighbors_map = {}
    for i, (nid, idxs) in enumerate(zip(new_ids, indices)):
        nbrs = [all_ids[j] for j in idxs if all_ids[j] != nid][:k]
        neighbors_map[nid] = nbrs

    return neighbors_map

# ── manga_map.json 構築 ──────────────────────────────────────────────────────

def build_map_entries(new_manga: list[dict], new_coords, neighbors_map: dict, existing_slugs: set) -> list[dict]:
    entries = []
    for manga, xyz in zip(new_manga, new_coords):
        mid  = manga["id"]
        slug = make_slug(manga.get("title_romaji", ""), mid, existing_slugs)
        existing_slugs.add(slug)

        genres = manga.get("genres", [])
        entries.append({
            "id":           mid,
            "slug":         slug,
            "title":        manga["title"],
            "title_ja":     manga.get("title_ja", ""),
            "title_romaji": manga.get("title_romaji", ""),
            "x":            round(float(xyz[0]), 4),
            "y":            round(float(xyz[1]), 4),
            "z":            round(float(xyz[2]), 4),
            "cluster_id":   -1,          # 差分追加は未クラスタリング
            "tags":         manga.get("tags", []),
            "genre":        genres[0].lower() if genres else "unknown",
            "synopsis":     manga.get("synopsis", ""),
            "popularity":   manga.get("popularity", 1),
            "score":        manga.get("score"),
            "year":         manga.get("year"),
            "cover":        manga.get("cover", ""),
            "url":          manga.get("url", ""),
            "neighbors":    neighbors_map.get(mid, []),
            # 楽天データは空（fetch_rakuten.py で後から補完可能）
            "image_url":    None,
            "affiliate_url": None,
            "isbn":         None,
            "author":       None,
        })
    return entries

# ── PostgreSQL UPSERT ────────────────────────────────────────────────────────

def upsert_to_db(entries: list[dict], db_url: str):
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        print("  psycopg2 未インストール → DB 更新スキップ")
        return

    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        BATCH = 200

        # ── manga ─────────────────────────────────────────────────────────
        manga_rows = [
            (
                e["id"], e.get("slug"), e["title"], e.get("title_ja"), e.get("title_romaji"),
                e["x"], e["y"], e["z"], e["cluster_id"],
                e["genre"], e.get("synopsis"), None,   # synopsis_ja=None
                e["popularity"], e["score"], e["year"],
                e["cover"], e["url"],
                None, None, None, None, None, None, None, 0,  # 楽天フィールド
            )
            for e in entries
        ]
        psycopg2.extras.execute_values(cur, """
            INSERT INTO manga (
                id, slug, title, title_ja, title_romaji,
                x, y, z, cluster_id, genre, synopsis, synopsis_ja,
                popularity, score, year, cover, url,
                image_url, affiliate_url, isbn, author, publisher, sales_date,
                review_average, review_count
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                title        = EXCLUDED.title,
                title_ja     = EXCLUDED.title_ja,
                title_romaji = EXCLUDED.title_romaji,
                x            = EXCLUDED.x,
                y            = EXCLUDED.y,
                z            = EXCLUDED.z,
                genre        = EXCLUDED.genre,
                synopsis     = COALESCE(manga.synopsis, EXCLUDED.synopsis),
                popularity   = EXCLUDED.popularity,
                score        = EXCLUDED.score,
                year         = EXCLUDED.year,
                cover        = EXCLUDED.cover,
                url          = EXCLUDED.url
        """, manga_rows, page_size=BATCH)

        # ── manga_tags ─────────────────────────────────────────────────────
        tag_rows = []
        for e in entries:
            for tag in e.get("tags", []):
                if not isinstance(tag, dict) or tag.get("spoiler", False):
                    continue
                tag_rows.append((e["id"], tag["name"], tag.get("rank", 0), False))
        if tag_rows:
            psycopg2.extras.execute_values(cur, """
                INSERT INTO manga_tags (manga_id, tag_name, rank, spoiler) VALUES %s
                ON CONFLICT (manga_id, tag_name) DO UPDATE SET rank = EXCLUDED.rank
            """, tag_rows, page_size=BATCH)

        # ── manga_neighbors ────────────────────────────────────────────────
        # 既存 ID セットを取得（外部キー制約チェック用）
        all_ids_in_entry = {e["id"] for e in entries}
        nb_rows = []
        for e in entries:
            for pos, nid in enumerate(e.get("neighbors", []), start=1):
                nb_rows.append((e["id"], nid, pos))

        if nb_rows:
            # 参照先が DB に存在するものだけ挿入
            cur.execute("SELECT id FROM manga WHERE id = ANY(%s)",
                        ([r[1] for r in nb_rows],))
            valid_nb_ids = {r[0] for r in cur.fetchall()}
            nb_rows = [(mid, nid, pos) for mid, nid, pos in nb_rows if nid in valid_nb_ids]
            if nb_rows:
                psycopg2.extras.execute_values(cur, """
                    INSERT INTO manga_neighbors (manga_id, neighbor_id, position) VALUES %s
                    ON CONFLICT (manga_id, neighbor_id) DO UPDATE SET position = EXCLUDED.position
                """, nb_rows, page_size=BATCH)

        # ── slug が NULL のままの場合に補完 ─────────────────────────────────
        cur.execute("""
            UPDATE manga SET slug = id
            WHERE slug IS NULL AND id = ANY(%s)
        """, ([e["id"] for e in entries],))

        conn.commit()
        print(f"  DB UPSERT 完了: {len(entries)} 件")
    finally:
        conn.close()

# ── キャッシュ無効化 ─────────────────────────────────────────────────────────

def invalidate_cache():
    try:
        req = urllib.request.Request(
            "http://localhost:8000/api/admin/invalidate-cache", method="POST"
        )
        with urllib.request.urlopen(req, timeout=3) as res:
            print(f"  キャッシュ無効化: {res.read().decode()}")
    except Exception as e:
        print(f"  キャッシュ無効化スキップ（サーバー未起動 or エラー: {e}）")

# ── モデルアーティファクト更新 ───────────────────────────────────────────────

def update_model_coords(new_coords, new_ids: list):
    """差分追加した座標を coords.npy / manga_ids.json に追記する"""
    import numpy as np

    existing_coords = np.load(MODEL_DIR / "coords.npy")
    existing_ids    = load_json(MODEL_DIR / "manga_ids.json")

    updated_coords = np.vstack([existing_coords, new_coords.astype(np.float32)])
    updated_ids    = existing_ids + new_ids

    np.save(MODEL_DIR / "coords.npy", updated_coords)
    save_json(MODEL_DIR / "manga_ids.json", updated_ids)
    print(f"  モデル座標更新: {len(existing_ids)} → {len(updated_ids)} 件")

# ── メイン ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AniList 差分同期")
    parser.add_argument("--dry-run", action="store_true", help="変更を適用せず確認のみ")
    parser.add_argument("--days",    type=int, default=None, help="N 日前から強制取得")
    parser.add_argument("--limit",  type=int, default=500,  help="新規追加上限件数")
    parser.add_argument("--db-url", default=DEFAULT_DB_URL)
    args = parser.parse_args()

    now_ts = int(time.time())

    if args.days is not None:
        since_ts = now_ts - args.days * 86400
        print(f"\n[設定] 過去 {args.days} 日分を対象 (since={since_ts})")
    else:
        since_ts = load_sync_state()
        dt = datetime.fromtimestamp(since_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        print(f"\n[設定] 前回同期: {dt}")

    # ── 1. モデル読み込み ──────────────────────────────────────────────────
    print("\n[1/7] モデルアーティファクト読み込み")
    reducer, norm_params, tag_vocab, tag_idf, existing_coords, existing_ids = load_model_artifacts()
    existing_id_set = set(existing_ids)

    # ── 2. manga_map.json & merged.json 読み込み ──────────────────────────
    print("\n[2/7] 既存データ読み込み")
    map_data    = load_json(MAP_FILE)
    merged_data = load_json(MERGED_FILE) if MERGED_FILE.exists() else []
    map_id_set  = {m["id"] for m in map_data}
    existing_slugs = {m.get("slug", "") for m in map_data if m.get("slug")}
    print(f"  manga_map.json: {len(map_data)} 件 / merged.json: {len(merged_data)} 件")

    # ── 3. AniList からフェッチ ───────────────────────────────────────────
    print(f"\n[3/7] AniList フェッチ (上限 {args.limit} 件)")
    fetched = fetch_updated_manga(since_ts, args.limit)
    print(f"  取得: {len(fetched)} 件")

    # 未登録に絞り込み
    new_manga = [m for m in fetched if m["id"] not in map_id_set]
    print(f"  新規（未登録）: {len(new_manga)} 件")

    if not new_manga:
        print("\n追加対象なし。同期状態を更新して終了。")
        if not args.dry_run:
            save_sync_state(now_ts)
        return

    # ── 4. 座標推定 ───────────────────────────────────────────────────────
    print(f"\n[4/7] UMAP 座標推定 ({len(new_manga)} 件)")
    new_coords = infer_coords(new_manga, reducer, norm_params, tag_vocab, tag_idf)

    # ── 5. neighbors 計算 ─────────────────────────────────────────────────
    print(f"\n[5/7] neighbors 計算 (k=12)")
    new_ids       = [m["id"] for m in new_manga]
    neighbors_map = compute_neighbors(new_coords, new_ids, existing_coords, existing_ids, k=12)

    # ── 6. 出力データ構築 ─────────────────────────────────────────────────
    print(f"\n[6/7] 出力データ構築")
    new_entries = build_map_entries(new_manga, new_coords, neighbors_map, existing_slugs)

    if args.dry_run:
        print(f"\n[dry-run] 以下の {len(new_entries)} 件を追加予定:")
        for e in new_entries[:10]:
            print(f"  {e['id']:>8}  {e['title_ja'] or e['title']}")
        if len(new_entries) > 10:
            print(f"  ... 他 {len(new_entries)-10} 件")
        print("\n[dry-run] 変更は適用されていません")
        return

    # ── 7. 保存・更新 ─────────────────────────────────────────────────────
    print(f"\n[7/7] 保存・更新")

    # manga_map.json
    updated_map = map_data + new_entries
    shutil.copy(MAP_FILE, MAP_FILE.with_suffix(f".bak_{now_ts}.json"))
    save_json(MAP_FILE, updated_map)
    OUTPUT_MAP.parent.mkdir(exist_ok=True)
    save_json(OUTPUT_MAP, updated_map)
    print(f"  manga_map.json: {len(map_data)} → {len(updated_map)} 件")

    # merged.json
    if MERGED_FILE.exists():
        shutil.copy(MERGED_FILE, MERGED_FILE.with_suffix(f".bak_{now_ts}.json"))
        updated_merged = merged_data + new_manga
        save_json(MERGED_FILE, updated_merged)
        print(f"  merged.json: {len(merged_data)} → {len(updated_merged)} 件")

    # PostgreSQL
    upsert_to_db(new_entries, args.db_url)

    # モデル座標を追記
    update_model_coords(new_coords, new_ids)

    # キャッシュ無効化
    invalidate_cache()

    # 同期状態を更新
    save_sync_state(now_ts)
    dt = datetime.fromtimestamp(now_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"\n完了: {len(new_entries)} 件を追加しました（同期時刻: {dt}）")


if __name__ == "__main__":
    main()
