import os
"""
楽天BooksAPIで第1巻を明示的に再検索してsynopsis_jaを修正するスクリプト
===================================================================
fetch_rakuten.py がタイトルの巻数を除去して検索していたため、
別の巻のデータが取得されてしまった作品を対象に、
"{title_ja} 1巻" で再検索して synopsis_ja / isbn / image_url 等を更新する。

事前に check_wrong_volume.py を実行して wrong_volume.txt を生成しておくと
対象を絞れるが、なくても DB から直接 synopsis_ja ありの全件を対象にできる。

使い方:
    # wrong_volume.txt を使って対象を絞る（推奨）
    python backend/scripts/fix_rakuten_v1.py \\
        --app-id YOUR_APP_ID \\
        --access-key YOUR_ACCESS_KEY \\
        --affiliate-id YOUR_AFFILIATE_ID \\
        --origin https://your-site.example.com \\
        --wrong-file wrong_volume.txt

    # DB の synopsis_ja あり全件を対象にする
    python backend/scripts/fix_rakuten_v1.py \\
        --app-id YOUR_APP_ID \\
        --access-key YOUR_ACCESS_KEY \\
        --affiliate-id YOUR_AFFILIATE_ID \\
        --origin https://your-site.example.com

    # チェックポイントから再開
    python backend/scripts/fix_rakuten_v1.py ... --resume
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

API_URL        = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404"
MIN_SLEEP_SEC  = 1.5
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")

SCRIPT_DIR       = Path(__file__).parent
CHECKPOINT_FILE  = SCRIPT_DIR.parent / "data" / "fix_v1_checkpoint.json"


# ── タイトル正規化（巻数は除去せず "1巻" を付加） ────────────────────────────

def make_v1_query(title_ja: str) -> str:
    """
    title_ja から検索用クエリを生成する。
    既存の巻数表記を取り除いた上で "1巻" を付加。
    例: "キングダム 72" → "キングダム 1巻"
        "進撃の巨人"    → "進撃の巨人 1巻"
    """
    title = re.sub(r"\s+", " ", title_ja).strip()
    # 末尾の巻数表記を除去
    title = re.sub(r"[\s　]*第?\s*\d+\s*巻?\s*$", "", title).strip()
    # コロン・括弧以降を除去（サブタイトル等）
    title = re.split(r"[:：｜|（(]", title)[0].strip()
    return f"{title} 1巻"


# ── 楽天 API 検索 ────────────────────────────────────────────────────────────

def search_rakuten_v1(
    title_ja: str, app_id: str, access_key: str, affiliate_id: str, origin: str
) -> dict | None:
    """楽天 Books API で "{title_ja} 1巻" を検索し、最初のヒットを返す"""
    query = make_v1_query(title_ja)
    params = {
        "applicationId": app_id,
        "accessKey":     access_key,
        "affiliateId":   affiliate_id,
        "title":         query,
        "hits":          3,
        "format":        "json",
    }
    headers = {"Referer": origin + "/", "Origin": origin}

    for attempt in range(4):
        try:
            resp = requests.get(API_URL, params=params, headers=headers, timeout=15)
            if resp.status_code == 429:
                wait = 15 * (attempt + 1)
                print(f"  429 待機 {wait}s ...", end=" ", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            items = resp.json().get("Items", [])
            if not items:
                return None

            item = items[0]["Item"]
            # affiliateUrl が取れた場合のみ affiliate_url にセット
            aff_url = item.get("affiliateUrl") or ""
            return {
                "isbn":           item.get("isbn", ""),
                "affiliate_url":  aff_url,          # affiliateUrl のみ（itemUrl は使わない）
                "image_url":      item.get("largeImageUrl", ""),
                "author":         item.get("author", ""),
                "publisher":      item.get("publisherName", ""),
                "sales_date":     item.get("salesDate", ""),
                "review_average": item.get("reviewAverage", ""),
                "review_count":   item.get("reviewCount", 0),
                "synopsis_ja":    item.get("itemCaption", ""),
            }
        except Exception as e:
            print(f"  エラー: {e}")
            return None

    print("  リトライ上限")
    return None


# ── DB 更新 ──────────────────────────────────────────────────────────────────

UPDATE_FIELDS = [
    "synopsis_ja", "isbn", "image_url", "affiliate_url",
    "author", "publisher", "sales_date", "review_average", "review_count",
]

def update_manga(cur, manga_id: str, data: dict):
    """取得できたフィールドだけ UPDATE する"""
    sets, vals = [], []
    for field in UPDATE_FIELDS:
        val = data.get(field)
        if field == "review_count":
            # 0 も有効値なので None チェックのみ
            if val is not None:
                sets.append(f"{field} = %s")
                vals.append(val)
        elif val:  # 空文字・None はスキップ
            sets.append(f"{field} = %s")
            vals.append(str(val) if field == "review_average" else val)
    if not sets:
        return
    vals.append(manga_id)
    cur.execute(f"UPDATE manga SET {', '.join(sets)} WHERE id = %s", vals)


# ── チェックポイント ─────────────────────────────────────────────────────────

def load_checkpoint() -> tuple[int, dict]:
    if CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE, encoding="utf-8") as f:
            ckpt = json.load(f)
        return ckpt.get("index", 0), ckpt.get("done_ids", {})
    return 0, {}


def save_checkpoint(index: int, done_ids: dict):
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump({"index": index, "done_ids": done_ids}, f, ensure_ascii=False)


# ── メイン ───────────────────────────────────────────────────────────────────

def load_target_rows(conn, wrong_file: Path | None) -> list[dict]:
    """更新対象の (id, title_ja) リストを返す"""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if wrong_file and wrong_file.exists():
        # wrong_volume.txt から manga_id を読み込む
        ids = []
        with open(wrong_file, encoding="utf-8") as f:
            next(f)  # ヘッダースキップ
            for line in f:
                parts = line.strip().split("\t")
                if parts:
                    ids.append(parts[0])
        if not ids:
            return []
        cur.execute(
            "SELECT id, title_ja FROM manga WHERE id = ANY(%s) AND title_ja IS NOT NULL",
            (ids,)
        )
        print(f"wrong_volume.txt から {len(ids):,} 件を読み込み")
    else:
        # DB から synopsis_ja あり・日本語タイトルのものを全件取得
        cur.execute("""
            SELECT id, title_ja FROM manga
            WHERE title_ja IS NOT NULL AND title_ja <> ''
              AND synopsis_ja IS NOT NULL AND synopsis_ja <> ''
        """)
        print("wrong_volume.txt なし → DB から synopsis_ja あり全件を対象")

    return [dict(r) for r in cur.fetchall()]


def main():
    parser = argparse.ArgumentParser(
        description="楽天BooksAPIで第1巻を再検索してsynopsis_jaを修正"
    )
    parser.add_argument("--app-id",       required=True)
    parser.add_argument("--access-key",   required=True)
    parser.add_argument("--affiliate-id", required=True)
    parser.add_argument("--origin",       required=True,
                        help="アプリ登録ドメイン (例: https://your-site.example.com)")
    parser.add_argument("--db-url",       default=DEFAULT_DB_URL)
    parser.add_argument("--wrong-file",   default=None,
                        help="check_wrong_volume.py が出力した wrong_volume.txt のパス")
    parser.add_argument("--qps",          type=float, default=0.6,
                        help="リクエスト数/秒（デフォルト: 0.6 = 約1.7秒間隔）")
    parser.add_argument("--resume",       action="store_true",
                        help="チェックポイントから再開")
    args = parser.parse_args()

    sleep_sec   = 1.0 / args.qps
    wrong_file  = Path(args.wrong_file) if args.wrong_file else None

    print("PostgreSQL に接続中...")
    conn = psycopg2.connect(args.db_url)
    rows = load_target_rows(conn, wrong_file)
    total = len(rows)
    if not rows:
        print("対象なし。終了します。")
        conn.close()
        return
    print(f"対象: {total:,} 件")
    print(f"QPS: {args.qps}  推定時間: ~{int(total / args.qps / 3600 * 10) / 10:.1f} 時間\n")

    # チェックポイント
    start_index, done_ids = 0, {}
    if args.resume:
        start_index, done_ids = load_checkpoint()
        print(f"チェックポイントから再開: {start_index:,} 件目 / 処理済 {len(done_ids):,} 件\n")

    cur      = conn.cursor()
    matched  = len(done_ids)
    skipped  = 0

    for i, row in enumerate(rows[start_index:], start=start_index):
        manga_id = row["id"]
        title_ja = row["title_ja"]
        query    = make_v1_query(title_ja)

        print(f"[{i+1:>6}/{total}] {title_ja[:28]:<28} → 検索: {query[:30]}", end=" ", flush=True)

        result = search_rakuten_v1(
            title_ja, args.app_id, args.access_key, args.affiliate_id, args.origin
        )

        if result and result.get("synopsis_ja"):
            update_manga(cur, manga_id, result)
            conn.commit()
            done_ids[manga_id] = True
            matched += 1
            print(f"✓  {result.get('author','')[:20]}")
        else:
            skipped += 1
            print("✗  未マッチ or あらすじなし")

        # 1,000件ごとにチェックポイント保存
        if (i + 1) % 1000 == 0:
            save_checkpoint(i + 1, done_ids)
            print(f"\n  ── チェックポイント保存: {i+1:,} 件 ──\n")

        time.sleep(max(sleep_sec * random.uniform(0.7, 1.3), MIN_SLEEP_SEC))

    # 後片付け
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()

    conn.close()

    print(f"\n{'='*60}")
    print(f"完了")
    print(f"  更新:   {matched:,} 件")
    print(f"  未取得: {skipped:,} 件")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
