import os
"""
楽天Books API で affiliate_url と画像URLを取得するスクリプト
==========================================================
rebuild_from_openbd.py で OpenBD の信頼性の高い ISBN を DB に入れた後、
その ISBN を使って楽天を検索し affiliate_url / image_url を取得する。

ISBN がない作品はタイトルで検索するフォールバックあり（--no-title-fallback で無効化）。

取得フィールド:
    affiliate_url  … 楽天アフィリエイトリンク（affiliateUrl のみ。itemUrl は使用しない）
    image_url      … 楽天の高解像度書影（largeImageUrl）

synopsis_ja / isbn 等は OpenBD の値を維持し、上書きしない。

━━ 使い方 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # ISBN あり作品だけ（推奨）
  python backend/scripts/fetch_rakuten_links.py \\
    --app-id YOUR_APP_ID \\
    --access-key YOUR_ACCESS_KEY \\
    --affiliate-id YOUR_AFFILIATE_ID \\
    --origin https://your-site.example.com

  # ISBN なし作品もタイトル検索でフォールバック
  python backend/scripts/fetch_rakuten_links.py ... --title-fallback

  # チェックポイントから再開
  python backend/scripts/fetch_rakuten_links.py ... --resume

  # QPS 調整（デフォルト 0.6 req/s ≈ 1.7秒間隔）
  python backend/scripts/fetch_rakuten_links.py ... --qps 0.5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import argparse
import json
import random
import re
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests

API_URL        = "https://openapi.rakuten.co.jp/services/api/BooksTotal/Search/20170404"
COMIC_GENRE_ID = "001001"  # 楽天Books コミック全般ジャンルID
MIN_SLEEP_SEC  = 1.5
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")

SCRIPT_DIR      = Path(__file__).parent
CHECKPOINT_FILE = SCRIPT_DIR.parent / "data" / "rakuten_links_checkpoint.json"


# ── 楽天 API 検索 ─────────────────────────────────────────────────────────────

def _base_params(app_id: str, access_key: str, affiliate_id: str) -> dict:
    params = {
        "applicationId": app_id,
        "accessKey":     access_key,
        "hits":          1,
        "format":        "json",
    }
    if affiliate_id:
        params["affiliateId"] = affiliate_id
    return params


def _parse_result(items: list) -> dict | None:
    """楽天APIレスポンスから affiliate_url / image_url を抽出"""
    if not items:
        return None
    item = items[0].get("Item", {})

    # アフィリエイトURL: affiliateUrl → itemUrl の優先順
    aff_url = (item.get("affiliateUrl") or item.get("itemUrl") or "").strip()

    # 画像URL: large → medium → small の優先順
    image_url = (
        item.get("largeImageUrl")
        or item.get("mediumImageUrl")
        or item.get("smallImageUrl")
        or ""
    ).strip()

    # どちらも取れなかった場合のみスキップ
    if not aff_url and not image_url:
        return None
    return {
        "affiliate_url": aff_url,
        "image_url":     image_url,
    }


def _call_api(params: dict, origin: str, debug: bool = False) -> list:
    """楽天APIを呼び出して Items リストを返す（失敗時は空リスト）"""
    headers = {"Referer": origin + "/", "Origin": origin}
    for attempt in range(4):
        try:
            resp = requests.get(API_URL, params=params, headers=headers, timeout=15)
            if debug:
                print(f"\n  [DEBUG] URL: {resp.url}")
                print(f"  [DEBUG] Status: {resp.status_code}")
                try:
                    body = resp.json()
                    print(f"  [DEBUG] Response: {json.dumps(body, ensure_ascii=False, indent=2)[:800]}")
                except Exception:
                    print(f"  [DEBUG] Body: {resp.text[:400]}")
            if resp.status_code == 429:
                wait = 15 * (attempt + 1)
                print(f"  429 待機 {wait}s ...", end=" ", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json().get("Items", [])
        except Exception as e:
            if attempt == 3:
                print(f"  エラー: {e}")
            time.sleep(3)
    return []


def search_by_isbn(
    isbn: str, app_id: str, access_key: str, affiliate_id: str, origin: str, debug: bool = False
) -> dict | None:
    """isbnjan パラメータで楽天を検索（BooksTotal API の正しいパラメータ名）"""
    isbn_clean = re.sub(r"[-\s]", "", isbn)
    params = {**_base_params(app_id, access_key, affiliate_id), "isbnjan": isbn_clean}
    return _parse_result(_call_api(params, origin, debug))


def _normalize_for_search(title: str) -> str:
    """タイトルから巻数・サブタイトルを除去して検索用に整形"""
    t = re.sub(r"\s+", " ", title).strip()
    t = re.sub(r"[\s　]*第?\s*\d+\s*巻?\s*$", "", t).strip()
    t = re.split(r"[:：｜|（(]", t)[0].strip()
    return t


def search_by_title_comic(
    title_ja: str, title: str,
    app_id: str, access_key: str, affiliate_id: str, origin: str, debug: bool = False
) -> dict | None:
    """タイトルキーワード＋コミックジャンルで楽天を検索（ISBNヒットなし時のフォールバック）"""
    raw = title_ja if title_ja else title
    query = _normalize_for_search(raw)
    if not query:
        return None
    params = {
        **_base_params(app_id, access_key, affiliate_id),
        "keyword":      query,
        "booksGenreId": COMIC_GENRE_ID,
    }
    return _parse_result(_call_api(params, origin, debug))


def search_by_isbn_then_title_comic(
    isbn: str, title_ja: str, title: str,
    app_id: str, access_key: str, affiliate_id: str, origin: str, debug: bool = False
) -> tuple[dict | None, str]:
    """ISBN検索 → ヒットなしならタイトル＋コミックジャンル検索。(result, method) を返す"""
    result = search_by_isbn(isbn, app_id, access_key, affiliate_id, origin, debug)
    if result:
        return result, "ISBN"
    result = search_by_title_comic(title_ja, title, app_id, access_key, affiliate_id, origin, debug)
    return result, "タイトル+コミックジャンル"


# ── DB 更新 ──────────────────────────────────────────────────────────────────

def update_links(cur, manga_id: str, data: dict):
    """affiliate_url / image_url のみ更新（空なら上書きしない）"""
    sets, vals = [], []
    if data.get("affiliate_url"):
        sets.append("affiliate_url = %s")
        vals.append(data["affiliate_url"])
    if data.get("image_url"):
        sets.append("image_url = %s")
        vals.append(data["image_url"])
    if not sets:
        return
    vals.append(manga_id)
    cur.execute(f"UPDATE manga SET {', '.join(sets)} WHERE id = %s", vals)


# ── チェックポイント ──────────────────────────────────────────────────────────

def load_checkpoint() -> tuple[int, set[str]]:
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE, encoding="utf-8") as f:
            ckpt = json.load(f)
        return ckpt.get("index", 0), set(ckpt.get("done_ids", []))
    return 0, set()


def save_checkpoint(index: int, done_ids: set[str]):
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump({"index": index, "done_ids": list(done_ids)}, f)


# ── メイン ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=__doc__,
    )
    parser.add_argument("--app-id",       required=True)
    parser.add_argument("--affiliate-id", default="",
                        help="楽天アフィリエイト ID（省略可）")
    parser.add_argument("--origin",       required=True,
                        help="アプリ登録ドメイン (例: https://your-site.example.com)")
    parser.add_argument("--db-url",       default=DEFAULT_DB_URL)
    parser.add_argument("--qps",          type=float, default=0.6,
                        help="リクエスト数/秒（デフォルト: 0.6 ≈ 1.7秒間隔）")
    parser.add_argument("--title-fallback", action="store_true",
                        help="ISBN なし作品もタイトル検索でフォールバック")
    parser.add_argument("--resume",       action="store_true",
                        help="チェックポイントから再開")
    parser.add_argument("--test-isbn",    default="",
                        help="指定 ISBN 1件だけ試してレスポンスを表示して終了")
    parser.add_argument("--debug",        action="store_true",
                        help="最初の数件のAPIレスポンスを表示")
    # 後方互換: --access-key は受け取るが使わない
    parser.add_argument("--access-key",   default="", help=argparse.SUPPRESS)
    args = parser.parse_args()

    sleep_sec = max(1.0 / args.qps, MIN_SLEEP_SEC)

    # ── テストモード ──────────────────────────────────────────────────────────
    if args.test_isbn:
        print(f"テスト: ISBN={args.test_isbn}")
        # DBからタイトルを引いて一緒に渡す
        conn_t = psycopg2.connect(args.db_url)
        cur_t  = conn_t.cursor()
        cur_t.execute("SELECT title_ja, title FROM manga WHERE isbn = %s LIMIT 1", (args.test_isbn,))
        row_t = cur_t.fetchone()
        conn_t.close()
        t_ja = row_t[0] if row_t else ""
        t_en = row_t[1] if row_t else ""
        print(f"  DB title_ja={t_ja!r}  title={t_en!r}")
        result, method = search_by_isbn_then_title_comic(
            args.test_isbn, t_ja, t_en,
            args.app_id, args.access_key, args.affiliate_id, args.origin, debug=True
        )
        print(f"\n結果 ({method}): {result}")
        return

    conn = psycopg2.connect(args.db_url)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # ── 対象を取得 ────────────────────────────────────────────────────────────
    if args.title_fallback:
        # isbn あり + isbn なし（affiliate_url が空のもの全件）
        cur.execute("""
            SELECT id, title_ja, title, isbn
            FROM manga
            WHERE (affiliate_url IS NULL OR affiliate_url = '')
            ORDER BY
                CASE WHEN isbn IS NOT NULL AND isbn <> '' THEN 0 ELSE 1 END,
                id
        """)
    else:
        # isbn ありのみ
        cur.execute("""
            SELECT id, title_ja, title, isbn
            FROM manga
            WHERE isbn IS NOT NULL AND isbn <> ''
              AND (affiliate_url IS NULL OR affiliate_url = '')
            ORDER BY id
        """)

    rows  = [dict(r) for r in cur.fetchall()]
    total = len(rows)

    isbn_count  = sum(1 for r in rows if r["isbn"])
    title_count = total - isbn_count

    if not args.title_fallback:
        print("対象: OpenBD でマッチした AniList 作品のみ（isbn あり）")
    else:
        print("対象: isbn あり（OpenBD マッチ済み）+ isbn なし（全作品）")
    print(f"      {total:,} 件  (ISBN検索: {isbn_count:,} 件 / タイトル検索: {title_count:,} 件)")
    print(f"QPS: {args.qps}  推定時間: ~{int(total / args.qps / 3600 * 10) / 10:.1f} 時間\n")

    # ── チェックポイント ──────────────────────────────────────────────────────
    start_index, done_ids = 0, set()
    if args.resume:
        start_index, done_ids = load_checkpoint()
        print(f"チェックポイントから再開: {start_index:,} 件目 / 処理済 {len(done_ids):,} 件\n")

    plain_cur  = conn.cursor()
    matched    = len(done_ids)
    skipped    = 0
    isbn_hits  = 0
    title_hits = 0

    for i, row in enumerate(rows[start_index:], start=start_index):
        manga_id = row["id"]
        isbn     = row["isbn"] or ""
        title_ja = row["title_ja"] or ""
        title    = row["title"] or ""

        label = (isbn if isbn else (title_ja or title))[:30]
        print(f"[{i+1:>6}/{total}] {label:<32}", end=" ", flush=True)

        dbg = args.debug and i < 3
        if isbn:
            # ISBN検索 → ヒットなしならタイトル+コミックジャンル検索
            result, method = search_by_isbn_then_title_comic(
                isbn, title_ja, title,
                args.app_id, args.access_key, args.affiliate_id, args.origin, debug=dbg
            )
            if result:
                if method == "ISBN":
                    isbn_hits += 1
                else:
                    title_hits += 1
        else:
            # ISBNなし → タイトル+コミックジャンル検索（--title-fallback 時のみ対象に含まれる）
            result = search_by_title_comic(title_ja, title, args.app_id, args.access_key, args.affiliate_id, args.origin, debug=dbg)
            method = "タイトル"
            if result:
                title_hits += 1

        if result:
            update_links(plain_cur, manga_id, result)
            conn.commit()
            done_ids.add(manga_id)
            matched += 1
            print(f"✓ [{method}]  aff={'あり' if result.get('affiliate_url') else 'なし'}  img={'あり' if result.get('image_url') else 'なし'}")
        else:
            skipped += 1
            print("✗  未ヒット")

        # 1,000件ごとにチェックポイント保存
        if (i + 1) % 1_000 == 0:
            save_checkpoint(i + 1, done_ids)
            print(f"\n  ── チェックポイント保存: {i+1:,} 件 ──\n")

        time.sleep(sleep_sec * random.uniform(0.8, 1.2))

    # 後片付け
    CHECKPOINT_FILE.unlink(missing_ok=True)
    conn.close()

    print(f"\n{'='*60}")
    print(f"完了")
    print(f"  リンク取得成功 : {matched:,} 件")
    print(f"    うち ISBN 検索 : {isbn_hits:,} 件")
    print(f"    うちタイトル検索: {title_hits:,} 件")
    print(f"  未取得         : {skipped:,} 件")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
