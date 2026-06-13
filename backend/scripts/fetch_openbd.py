import os
"""
OpenBD / Google Books API から日本語あらすじを取得して DB を更新するスクリプト
============================================================================

【モード1: デフォルト】  既存 isbn → OpenBD で一括取得（最速）
【モード2: --search-v1】 Google Books で "{title_ja} 1巻" を検索してあらすじを取得
                         NDL より manga カバレッジが高く、並列処理で高速

使い方:
    # モード1: 既存 ISBN で OpenBD から取得（空のみ）
    python backend/scripts/fetch_openbd.py --only-empty

    # モード2: Google Books で第1巻を検索（空のみ・8並列）
    python backend/scripts/fetch_openbd.py --search-v1 --only-empty

    # モード2: 並列数を増やす（API キーなしの場合は 5 以下推奨）
    python backend/scripts/fetch_openbd.py --search-v1 --only-empty --workers 5

    # モード2: Google Books API キーあり（1日上限が大幅増）
    python backend/scripts/fetch_openbd.py --search-v1 --only-empty --api-key YOUR_KEY --workers 10

    # 書き込まず確認だけ
    python backend/scripts/fetch_openbd.py --search-v1 --only-empty --dry-run
"""

import argparse
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import psycopg2
import psycopg2.extras
import requests

OPENBD_API      = "https://api.openbd.jp/v1/get"
GBOOKS_API      = "https://www.googleapis.com/books/v1/volumes"
OPENBD_BATCH    = 1000
DEFAULT_DB_URL  = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")

# Google Books: API キーなしは ~1 req/sec が安全ライン
# API キーあり（無料枠）は ~10 req/sec まで可
_rate_lock  = Lock()
_last_req   = 0.0


def _rate_limited_get(url: str, params: dict, min_interval: float = 1.0, timeout: int = 10):
    """レート制限付き requests.get（スレッドセーフ）"""
    global _last_req
    with _rate_lock:
        wait = min_interval - (time.time() - _last_req)
        if wait > 0:
            time.sleep(wait)
        _last_req = time.time()
    return requests.get(url, params=params, timeout=timeout)


# ── 日本語タイトル判定 ───────────────────────────────────────────────────────

_JP_RE = re.compile(r'[\u3041-\u3096\u30A1-\u30FA]')  # ひらがな or カタカナ

def _is_japanese_title(title: str) -> bool:
    """ひらがな・カタカナを含む = 日本語タイトル（韓国語・中国語を除外）"""
    return bool(_JP_RE.search(title))


# ── 第1巻判定 ────────────────────────────────────────────────────────────────

_V1_PATTERNS = [
    re.compile(r'[(\[（【]\s*1\s*[)\]）】]'),
    re.compile(r'[\s　]第?\s*[1１一]\s*巻'),
    re.compile(r'[\s　]第?\s*[1１一]$'),
    re.compile(r'\s+1$'),
    re.compile(r'Vol\.?\s*1\b', re.IGNORECASE),
]

def _is_volume_1(title: str) -> bool:
    return any(p.search(title) for p in _V1_PATTERNS)


# ── OpenBD ──────────────────────────────────────────────────────────────────

def _extract_openbd_synopsis(item: dict) -> str:
    desc = (item.get("summary") or {}).get("description", "").strip()
    if desc:
        return desc
    try:
        for tc in item["onix"]["CollateralDetail"]["TextContent"]:
            if tc.get("TextType") == "03":
                t = (tc.get("Text") or "").strip()
                if t:
                    return t
    except (KeyError, TypeError):
        pass
    return ""


def fetch_openbd_by_isbns(isbns: list[str]) -> dict[str, str]:
    """ISBNリスト → {isbn: synopsis}"""
    results = {}
    n = len(isbns)
    batches = (n + OPENBD_BATCH - 1) // OPENBD_BATCH
    for b, i in enumerate(range(0, n, OPENBD_BATCH), 1):
        batch = isbns[i : i + OPENBD_BATCH]
        print(f"  OpenBD batch {b}/{batches} ({len(batch)} ISBN) ...", end=" ", flush=True)
        try:
            resp = requests.get(OPENBD_API,
                                params={"isbn": ",".join(batch)}, timeout=30)
            resp.raise_for_status()
            hit = 0
            for item in resp.json():
                if not item:
                    continue
                isbn     = (item.get("summary") or {}).get("isbn", "").strip()
                synopsis = _extract_openbd_synopsis(item)
                if isbn and synopsis:
                    results[isbn] = synopsis
                    hit += 1
            print(f"ヒット {hit} 件")
        except Exception as e:
            print(f"エラー: {e}")
        if b < batches:
            time.sleep(0.5)
    return results


# ── Google Books ─────────────────────────────────────────────────────────────

def _search_gbooks_v1(title_ja: str, api_key: str | None,
                      min_interval: float) -> str | None:
    """Google Books で "{title_ja} 1巻" を検索し、第1巻のあらすじを返す"""
    params: dict = {
        "q":           f'"{title_ja}" 1巻',
        "langRestrict": "ja",
        "maxResults":  5,
        "printType":   "books",
        "orderBy":     "relevance",
    }
    if api_key:
        params["key"] = api_key

    try:
        resp = _rate_limited_get(GBOOKS_API, params, min_interval=min_interval)
        if resp.status_code == 429:
            time.sleep(10)
            return None
        resp.raise_for_status()
        items = resp.json().get("items", [])
    except Exception:
        return None

    for item in items:
        info  = item.get("volumeInfo", {})
        title = f"{info.get('title','')} {info.get('subtitle','')}".strip()
        desc  = info.get("description", "").strip()
        if _is_volume_1(title) and desc:
            return desc

    # 第1巻判定に引っかからなくても先頭に description があれば採用
    for item in items:
        desc = (item.get("volumeInfo") or {}).get("description", "").strip()
        if desc:
            return desc

    return None


def fetch_gbooks_v1_parallel(
    rows: list[dict],          # [{id, title_ja}, ...]
    api_key: str | None,
    workers: int,
    min_interval: float,
) -> dict[str, str]:           # {manga_id: synopsis}
    """ThreadPoolExecutor で並列取得"""
    results: dict[str, str] = {}
    total   = len(rows)
    done    = 0
    lock    = Lock()

    def _task(row):
        synopsis = _search_gbooks_v1(row["title_ja"], api_key, min_interval)
        return row["id"], row["title_ja"], synopsis

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(_task, row): row for row in rows}
        for fut in as_completed(futures):
            manga_id, title_ja, synopsis = fut.result()
            with lock:
                done += 1
                hit  = "✓" if synopsis else "✗"
                # 1行ずつ出力（\r上書きはWindowsで崩れるため改行方式に）
                print(f"  [{done:>6}/{total}] {hit} {title_ja[:30]:<30}  累計ヒット {len(results)} 件")
                if synopsis:
                    results[manga_id] = synopsis

    return results


# ── DB 更新 ──────────────────────────────────────────────────────────────────

def update_db(conn, id_synopsis: dict[str, str], dry_run: bool) -> int:
    if dry_run:
        print(f"\n[DRY RUN] {len(id_synopsis)} 件を更新予定（最初の10件）:")
        for mid, syn in list(id_synopsis.items())[:10]:
            print(f"  {mid}  {syn[:70]}...")
        return len(id_synopsis)

    cur = conn.cursor()
    for manga_id, synopsis in id_synopsis.items():
        cur.execute("UPDATE manga SET synopsis_ja = %s WHERE id = %s",
                    (synopsis, manga_id))
    conn.commit()
    return len(id_synopsis)


# ── モード1 ──────────────────────────────────────────────────────────────────

def run_isbn_mode(conn, only_empty: bool, dry_run: bool):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q   = """SELECT id, isbn FROM manga
             WHERE isbn IS NOT NULL AND isbn <> ''"""
    if only_empty:
        q += " AND (synopsis_ja IS NULL OR synopsis_ja = '')"
    cur.execute(q)
    rows       = cur.fetchall()
    isbn_to_id = {r["isbn"]: r["id"] for r in rows}
    print(f"対象: {len(rows):,} 件")
    if not rows:
        print("更新対象なし")
        return

    print("OpenBD API に問い合わせ中...")
    smap = fetch_openbd_by_isbns([r["isbn"] for r in rows])
    print(f"取得: {len(smap):,} 件 / {len(rows):,} 件")

    id_synopsis = {isbn_to_id[k]: v for k, v in smap.items() if k in isbn_to_id}
    n = update_db(conn, id_synopsis, dry_run)
    print(f"完了: {n:,} 件を更新")


# ── モード2 ──────────────────────────────────────────────────────────────────

def run_search_v1_mode(conn, only_empty: bool, fix_existing: bool, dry_run: bool,
                       workers: int, api_key: str | None):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    q   = """SELECT id, title_ja FROM manga
             WHERE title_ja IS NOT NULL AND title_ja <> ''"""
    if only_empty:
        q += " AND (synopsis_ja IS NULL OR synopsis_ja = '')"
    elif fix_existing:
        # 楽天で取得済み（= synopsis_ja あり）だが別巻の可能性があるものを修正
        q += " AND synopsis_ja IS NOT NULL AND synopsis_ja <> ''"
    cur.execute(q)
    all_rows = cur.fetchall()

    # 韓国語・中国語タイトル（ひらがな・カタカナなし）は Google Books JA で
    # ヒットしないためスキップ
    rows    = [r for r in all_rows if _is_japanese_title(r["title_ja"])]
    skipped = len(all_rows) - len(rows)
    total   = len(rows)
    print(f"対象: {len(all_rows):,} 件  → 日本語タイトルのみ: {total:,} 件"
          f"  (韓国語・中国語等 {skipped:,} 件スキップ)")
    print(f"workers={workers}")
    if not rows:
        print("更新対象なし")
        return

    # API キーなし: 1秒/req  キーあり: 0.12秒/req (≈8 req/s)
    min_interval = 0.12 if api_key else 1.0

    est_min = int(total * min_interval / workers / 60) + 1
    print(f"\nGoogle Books API で第1巻を検索中... (推定 ~{est_min} 分)\n")

    id_synopsis = fetch_gbooks_v1_parallel(rows, api_key, workers, min_interval)
    print(f"\nあらすじ取得: {len(id_synopsis):,} 件 / {total:,} 件")

    n = update_db(conn, id_synopsis, dry_run)
    print(f"完了: {n:,} 件を更新")


# ── エントリポイント ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description="""
対象の選び方:
  --fix-existing  楽天で取得済み (synopsis_ja あり) → 第1巻で上書き  ← 別巻修正用
  --only-empty    synopsis_ja が空のものだけ補完
  (なし)          全件処理
""")
    parser.add_argument("--db-url",       default=DEFAULT_DB_URL)
    parser.add_argument("--search-v1",    action="store_true",
                        help="Google Books で第1巻を検索するモード")
    parser.add_argument("--fix-existing", action="store_true",
                        help="synopsis_ja が入っているものを第1巻で上書き（別巻修正用）")
    parser.add_argument("--only-empty",   action="store_true",
                        help="synopsis_ja が空のものだけ補完")
    parser.add_argument("--workers",      type=int, default=5,
                        help="並列数（APIキーなし: 5以下推奨, キーあり: 10以下）")
    parser.add_argument("--api-key",      default=None,
                        help="Google Books API キー（任意。あると1日の上限が大幅増）")
    parser.add_argument("--dry-run",      action="store_true",
                        help="DBに書き込まず結果だけ表示")
    args = parser.parse_args()

    if args.fix_existing and args.only_empty:
        parser.error("--fix-existing と --only-empty は同時に指定できません")

    print("PostgreSQL に接続中...")
    conn = psycopg2.connect(args.db_url)

    if args.search_v1:
        print("=== モード2: Google Books で第1巻検索 ===\n")
        run_search_v1_mode(conn, args.only_empty, args.fix_existing, args.dry_run,
                           args.workers, args.api_key)
    else:
        print("=== モード1: 既存 ISBN → OpenBD ===\n")
        run_isbn_mode(conn, args.only_empty, args.dry_run)

    conn.close()


if __name__ == "__main__":
    main()
