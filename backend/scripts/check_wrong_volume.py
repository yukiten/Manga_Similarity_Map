import os
"""
楽天で取得した ISBN が第1巻以外かどうかを OpenBD で確認するスクリプト
===================================================================
OpenBD のレスポンスにはタイトルが含まれるため、
「キングダム 67」のように巻数が 2 以上のものを検出できる。

出力:
    wrong_volume.txt  ... 別巻と判定された manga_id, title_ja, isbn, openbd_title の一覧
    ok_volume.txt     ... 第1巻または巻数不明（問題なし）の一覧

使い方:
    python backend/scripts/check_wrong_volume.py
    python backend/scripts/check_wrong_volume.py --db-url postgresql://...
    python backend/scripts/check_wrong_volume.py --out-dir ./output
"""

import argparse
import re
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests

OPENBD_API     = "https://api.openbd.jp/v1/get"
BATCH_SIZE     = 1000
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")

# 「2巻以上」を示すパターン
_WRONG_VOLUME = re.compile(
    r'[\s　（(【\[]'          # 区切り文字
    r'第?\s*([2-9]|\d{2,})'  # 2〜9 または 2桁以上の数字
    r'\s*巻?'
    r'[\s　）)】\]]?$'        # 末尾
)

# 確実に第1巻と判定できるパターン
_IS_V1 = re.compile(
    r'[\s　（(【\[]?第?\s*[1１一]\s*巻[\s　）)】\]]?$'
)


def _get_volume(title: str) -> int | None:
    """タイトルから巻数を抽出する（わからなければ None）"""
    m = re.search(r'[\s　（(【\[第]([0-9１-９]+)巻?[\s　）)】\]$]', title)
    if m:
        n = m.group(1)
        # 全角数字を半角に変換
        n = n.translate(str.maketrans('１２３４５６７８９０', '1234567890'))
        try:
            return int(n)
        except ValueError:
            pass
    # 末尾の半角数字（例: "キングダム 67"）
    m2 = re.search(r'\s+(\d+)\s*$', title)
    if m2:
        return int(m2.group(1))
    return None


def fetch_openbd_titles(isbns: list[str]) -> dict[str, str]:
    """ISBN → OpenBD タイトルの辞書を返す（タイトルなし/未登録は含まない）"""
    result = {}
    total = len(isbns)
    batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

    for b, i in enumerate(range(0, total, BATCH_SIZE), 1):
        batch = isbns[i : i + BATCH_SIZE]
        print(f"  OpenBD batch {b}/{batches} ({len(batch)} ISBN) ...", end=" ", flush=True)
        try:
            resp = requests.get(OPENBD_API,
                                params={"isbn": ",".join(batch)}, timeout=30)
            resp.raise_for_status()
            hit = 0
            for item in resp.json():
                if not item:
                    continue
                isbn  = (item.get("summary") or {}).get("isbn", "").strip()
                title = (item.get("summary") or {}).get("title", "").strip()
                if isbn and title:
                    result[isbn] = title
                    hit += 1
            print(f"タイトル取得 {hit} 件")
        except Exception as e:
            print(f"エラー: {e}")
        if b < batches:
            time.sleep(0.3)
    return result


def main():
    parser = argparse.ArgumentParser(
        description="楽天取得 ISBN が第1巻以外かを OpenBD で確認"
    )
    parser.add_argument("--db-url",  default=DEFAULT_DB_URL)
    parser.add_argument("--out-dir", default=".", help="結果ファイルの出力先ディレクトリ")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("PostgreSQL に接続中...")
    conn = psycopg2.connect(args.db_url)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # synopsis_ja があり isbn もあるもの（楽天で取得済み）
    cur.execute("""
        SELECT id, title_ja, isbn FROM manga
        WHERE isbn IS NOT NULL AND isbn <> ''
          AND synopsis_ja IS NOT NULL AND synopsis_ja <> ''
    """)
    rows      = cur.fetchall()
    conn.close()
    total     = len(rows)
    isbn_to_row = {r["isbn"]: r for r in rows}

    print(f"対象: {total:,} 件（isbn + synopsis_ja あり）")
    print(f"\nOpenBD でタイトル確認中...")
    isbn_to_title = fetch_openbd_titles(list(isbn_to_row.keys()))
    print(f"OpenBD ヒット: {len(isbn_to_title):,} 件 / {total:,} 件")

    wrong  = []
    ok     = []
    no_data = []

    for isbn, row in isbn_to_row.items():
        ob_title = isbn_to_title.get(isbn)
        if not ob_title:
            no_data.append(row)
            continue

        vol = _get_volume(ob_title)
        if vol is not None and vol >= 2:
            wrong.append({**row, "openbd_title": ob_title, "volume": vol})
        else:
            ok.append({**row, "openbd_title": ob_title})

    # ── 結果表示 ─────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  別巻と判定 (vol >= 2) : {len(wrong):>6,} 件")
    print(f"  第1巻 or 巻数不明     : {len(ok):>6,} 件")
    print(f"  OpenBD 未登録         : {len(no_data):>6,} 件")
    print(f"{'='*60}")

    if wrong:
        print(f"\n別巻サンプル (最大20件):")
        for r in wrong[:20]:
            t = (r['title_ja'] or '')[:25]
            o = (r['openbd_title'] or '')[:40]
            print(f"  vol.{r['volume']:>2}  {t:<25}  → {o}")

    # ── ファイル出力 ──────────────────────────────────────────────────────────
    wrong_path = out_dir / "wrong_volume.txt"
    with open(wrong_path, "w", encoding="utf-8") as f:
        f.write("manga_id\ttitle_ja\tisbn\topenbd_title\tvolume\n")
        for r in wrong:
            f.write(f"{r['id']}\t{r['title_ja']}\t{r['isbn']}\t{r['openbd_title']}\t{r['volume']}\n")

    ok_path = out_dir / "ok_volume.txt"
    with open(ok_path, "w", encoding="utf-8") as f:
        f.write("manga_id\ttitle_ja\tisbn\topenbd_title\n")
        for r in ok:
            f.write(f"{r['id']}\t{r['title_ja']}\t{r['isbn']}\t{r['openbd_title']}\n")

    print(f"\n結果ファイル:")
    print(f"  別巻リスト : {wrong_path}  ({len(wrong):,} 件)")
    print(f"  正常リスト : {ok_path}  ({len(ok):,} 件)")
    print(f"\n次のステップ:")
    print(f"  wrong_volume.txt の件数を確認して、楽天APIで再取得するか検討してください。")


if __name__ == "__main__":
    main()
