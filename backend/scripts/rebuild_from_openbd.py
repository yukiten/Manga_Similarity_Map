import os
"""
楽天データをクリアして OpenBD データで DB を再構築するスクリプト
=====================================================================

フロー:
  Phase 1 (clear)  : isbn / synopsis_ja / image_url / affiliate_url /
                     author / publisher / sales_date / review_average /
                     review_count を NULL にリセット

  Phase 2 (match)  : OpenBD Coverage API で全 ISBN を取得し、
                     1000 件ずつバッチ取得 → レーベル名フィルタ → 第1巻絞り込み
                     → DB の title_ja と正規化マッチング → DB 更新

更新フィールド:
    isbn, synopsis_ja, image_url (表紙URL), author, publisher, sales_date

その後のフロー:
    fetch_rakuten_links.py  で OpenBD の ISBN を使って楽天から
    affiliate_url と高解像度書影を取得する。

━━ 使い方 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # フルで実行（クリア → マッチ）　← 通常はこれだけでOK
  python backend/scripts/rebuild_from_openbd.py

  # マッチのみ（クリア済みの場合、やり直し等）
  python backend/scripts/rebuild_from_openbd.py --phase match

  # 並列数を増やして高速化（デフォルト: 3）
  python backend/scripts/rebuild_from_openbd.py --workers 5

  # DB URL を指定
  python backend/scripts/rebuild_from_openbd.py --db-url postgresql://user:pass@host/db
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

所要時間の目安（OpenBD 全件 約300万ISBN・並列3）:
  Coverage ダウンロード : 1〜2 分
  バッチ取得・マッチング: 30〜60 分
"""

import argparse
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

import psycopg2
import psycopg2.extras
import requests

COVERAGE_URL   = "https://api.openbd.jp/v1/coverage"
BATCH_URL      = "https://api.openbd.jp/v1/get"
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")
API_BATCH_SIZE = 1000   # OpenBD の最大バッチサイズ
DB_BATCH_SIZE  = 500


# ══════════════════════════════════════════════════════════════════════════════
# タイトル正規化
# ══════════════════════════════════════════════════════════════════════════════

_VOL_SUFFIX = re.compile(
    r'[\s　]*'
    r'(?:'
    r'第?\s*[0-9０-９]{1,3}\s*巻'
    r'|[\(（\[【]\s*[0-9０-９]{1,3}\s*[\)）\]】]'
    r'|(?<=[\s　])[0-9０-９]{1,3}'
    r')'
    r'\s*$'
)


def normalize(title: str) -> str:
    """末尾巻数を除去 → NFKC → 小文字化"""
    if not title:
        return ""
    t = _VOL_SUFFIX.sub("", title).strip()
    t = unicodedata.normalize("NFKC", t)
    t = re.sub(r"[\s　]+", " ", t).strip().lower()
    return t


# ══════════════════════════════════════════════════════════════════════════════
# OpenBD データ抽出
# 注: OpenBD の Subject（C-code/NDC）フィールドはほぼ全件が空のため
#     コミック判定には使用しない。
#     summary.series（レーベル名）で明らかな非漫画を除外し、
#     残りはタイトルマッチングで絞り込む。
# ══════════════════════════════════════════════════════════════════════════════

# レーベル名が明らかに非漫画であることを示すキーワード
_NON_MANGA_SERIES_RE = re.compile(
    r'文庫|新書|選書|全集|文芸|学術|辞[典書]|事典|百科'
    r'|入門|講座|教科書|参考書|テキスト'
    r'|ビジネス|実用|ハウツー'
    r'|小説|ライトノベル|ラノベ'
    r'|写真集|画集|イラスト集'
    r'|詩集|歌集|句集'
    r'|岩波|ちくま|平凡社|中公|角川文庫|新潮文庫|集英社文庫',
    re.IGNORECASE,
)


def _is_manga_series(series: str) -> bool:
    """レーベル名が明らかな非漫画なら False を返す。空または不明なら True（タイトルマッチに委ねる）"""
    if not series:
        return True
    return not bool(_NON_MANGA_SERIES_RE.search(series))


_VOL_RE  = re.compile(
    r'[\s　（(\[【第]([0-9０-９]{1,3})[\s　)）\]】巻]'
    r'|[\s　]([0-9０-９]{1,3})\s*$'
)
_ZEN2HAN = str.maketrans("１２３４５６７８９０", "1234567890")


def _volume(title: str) -> int | None:
    m = _VOL_RE.search(title)
    if m:
        raw = (m.group(1) or m.group(2) or "").translate(_ZEN2HAN)
        try:
            return int(raw)
        except ValueError:
            pass
    return None


def _synopsis(item: dict) -> str:
    summary = item.get("summary") or {}
    desc = (summary.get("description") or "").strip()
    if desc:
        return desc
    try:
        for tc in item["onix"]["CollateralDetail"]["TextContent"]:
            if str(tc.get("TextType", "")) in ("02", "03"):
                text = (tc.get("Text") or "").strip()
                if text:
                    return text
    except (KeyError, TypeError):
        pass
    return ""


def extract_book(item: dict) -> dict | None:
    """isbn なし → None。レーベル名で明らかな非漫画を除外し、残りはタイトルマッチングで絞り込む。"""
    if not item:
        return None
    summary = item.get("summary") or {}
    isbn = (summary.get("isbn") or "").strip()
    if not isbn:
        return None
    # レーベル名フィルタ: 文庫・新書・小説など明らかな非漫画を除外
    series = (summary.get("series") or "").strip()
    if not _is_manga_series(series):
        return None
    title = (summary.get("title") or "").strip()
    return {
        "isbn":      isbn,
        "title":     title,
        "author":    (summary.get("author")    or "").strip(),
        "publisher": (summary.get("publisher") or "").strip(),
        "pubdate":   (summary.get("pubdate")   or "").strip(),
        "cover_url": (summary.get("cover")     or "").strip(),
        "synopsis":  _synopsis(item),
        "volume":    _volume(title),
    }


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Rakuten フィールドのクリア
# ══════════════════════════════════════════════════════════════════════════════

def phase_clear(conn):
    print("\n── Phase 1: Rakuten フィールドをクリア ──")
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM manga WHERE isbn IS NOT NULL AND isbn <> ''")
    before = cur.fetchone()[0]
    print(f"  クリア前: isbn あり {before:,} 件")
    cur.execute("""
        UPDATE manga SET
            isbn           = NULL,
            synopsis_ja    = NULL,
            image_url      = NULL,
            affiliate_url  = NULL,
            author         = NULL,
            publisher      = NULL,
            sales_date     = NULL,
            review_average = NULL,
            review_count   = 0
    """)
    rows = cur.rowcount
    conn.commit()
    print(f"  完了: {rows:,} 件をクリアしました\n")


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: OpenBD Coverage → バッチ取得 → マッチング → DB 更新
# ══════════════════════════════════════════════════════════════════════════════

def _fetch_batch(isbns: list[str]) -> list:
    """1000 件以下の ISBN を OpenBD に問い合わせてレスポンスリストを返す"""
    for attempt in range(3):
        try:
            resp = requests.get(
                BATCH_URL,
                params={"isbn": ",".join(isbns)},
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()
        except Exception:
            if attempt == 2:
                return []
            time.sleep(2 ** attempt)
    return []


def phase_match(conn, workers: int, out_dir: Path):
    print("\n── Phase 2: OpenBD Coverage API → バッチ取得 → マッチング ──")

    # ── DB タイトルインデックス構築 ──────────────────────────────────────────
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, title_ja, title FROM manga")
    db_rows = cur.fetchall()

    norm_index: dict[str, list[str]] = {}
    for r in db_rows:
        for raw in filter(None, [r["title_ja"], r["title"]]):
            key = normalize(raw)
            if key:
                norm_index.setdefault(key, [])
                if r["id"] not in norm_index[key]:
                    norm_index[key].append(r["id"])

    print(f"  DB 作品数: {len(db_rows):,} 件  正規化インデックス: {len(norm_index):,} キー")

    # ── Coverage ダウンロード ─────────────────────────────────────────────────
    print(f"\n  Coverage リストをダウンロード中: {COVERAGE_URL}")
    resp = requests.get(COVERAGE_URL, timeout=120)
    resp.raise_for_status()
    all_isbns: list[str] = resp.json()
    total_isbns = len(all_isbns)
    print(f"  Coverage: {total_isbns:,} 件の ISBN\n")

    # ── バッチリスト作成 ──────────────────────────────────────────────────────
    batches = [
        all_isbns[i : i + API_BATCH_SIZE]
        for i in range(0, total_isbns, API_BATCH_SIZE)
    ]
    total_batches = len(batches)
    print(f"  バッチ数: {total_batches:,}  並列数: {workers}  推定時間: ~{total_batches // workers // 60 + 1} 分\n")

    # ── 並列バッチ取得・マッチング ────────────────────────────────────────────
    matched:  dict[str, dict] = {}   # manga_id → rec
    conflict: list            = []
    no_match: list            = []
    lock = Lock()

    plain_cur    = conn.cursor()
    done_batches = 0
    comics_found = 0
    t0           = time.time()

    def process_batch(batch_isbns: list[str]):
        items     = _fetch_batch(batch_isbns)
        local_hit = []
        for item in items:
            rec = extract_book(item)
            if rec is None:
                continue
            # 第1巻または巻数不明のみ（2巻以降はスキップ）
            if rec["volume"] is not None and rec["volume"] != 1:
                continue
            # タイトルが DB に存在するものだけ残す（早期フィルタ）
            if normalize(rec["title"]) not in norm_index:
                continue
            local_hit.append(rec)
        return local_hit

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(process_batch, b): b for b in batches}
        for fut in as_completed(futures):
            hits = fut.result()
            done_batches += 1

            with lock:
                comics_found += len(hits)

                for rec in hits:
                    key        = normalize(rec["title"])
                    candidates = norm_index.get(key, [])

                    if len(candidates) == 1:
                        mid = candidates[0]
                        if mid not in matched or (
                            not matched[mid]["synopsis"] and rec["synopsis"]
                        ):
                            matched[mid] = rec
                    elif len(candidates) > 1:
                        conflict.append({**rec, "candidates": candidates})
                    else:
                        no_match.append(rec)

                # 進捗表示（100バッチごと）
                if done_batches % 100 == 0 or done_batches == total_batches:
                    elapsed = time.time() - t0
                    rate    = done_batches / elapsed if elapsed else 1
                    remain  = (total_batches - done_batches) / rate
                    print(
                        f"  [{done_batches:>5}/{total_batches}] "
                        f"第1巻候補 {comics_found:,} 件  "
                        f"DBマッチ {len(matched):,} 件  "
                        f"残り ~{int(remain/60)} 分",
                        flush=True,
                    )

    print(f"\n  マッチ結果:")
    print(f"    ユニークマッチ       : {len(matched):,} 件")
    print(f"    複数候補（スキップ） : {len(conflict):,} 件")
    print(f"    DB に存在せず        : {len(no_match):,} 件")

    # ── DB 更新 ──────────────────────────────────────────────────────────────
    print(f"\n  DB を更新中...")
    update_sql = """
        UPDATE manga SET
            isbn        = %s,
            synopsis_ja = CASE WHEN %s <> '' THEN %s ELSE synopsis_ja END,
            image_url   = CASE WHEN %s <> '' THEN %s ELSE image_url   END,
            author      = CASE WHEN %s <> '' THEN %s ELSE author      END,
            publisher   = CASE WHEN %s <> '' THEN %s ELSE publisher   END,
            sales_date  = CASE WHEN %s <> '' THEN %s ELSE sales_date  END
        WHERE id = %s
    """
    items   = list(matched.items())
    updated = 0
    for i in range(0, len(items), DB_BATCH_SIZE):
        for mid, rec in items[i : i + DB_BATCH_SIZE]:
            plain_cur.execute(update_sql, (
                rec["isbn"],
                rec["synopsis"],  rec["synopsis"],
                rec["cover_url"], rec["cover_url"],
                rec["author"],    rec["author"],
                rec["publisher"], rec["publisher"],
                rec["pubdate"],   rec["pubdate"],
                mid,
            ))
        conn.commit()
        updated += min(DB_BATCH_SIZE, len(items) - i)
        print(f"    {updated:,} / {len(matched):,} 件", end="\r", flush=True)

    print(f"\n  DB 更新完了: {updated:,} 件\n")

    _write_reports(out_dir, matched, conflict, no_match, db_rows)
    return updated


def _write_reports(out_dir, matched, conflict, no_match, db_rows):
    out_dir.mkdir(parents=True, exist_ok=True)
    mid_to_title = {r["id"]: (r["title_ja"] or r["title"]) for r in db_rows}

    p = out_dir / "openbd_matched.tsv"
    with open(p, "w", encoding="utf-8") as f:
        f.write("manga_id\ttitle_ja\tisbn\topenbd_title\thas_synopsis\n")
        for mid, rec in matched.items():
            f.write(f"{mid}\t{mid_to_title.get(mid,'')}\t{rec['isbn']}\t{rec['title']}\t{'yes' if rec['synopsis'] else 'no'}\n")
    print(f"  マッチ済み  : {p}")

    p = out_dir / "openbd_conflict.tsv"
    with open(p, "w", encoding="utf-8") as f:
        f.write("openbd_isbn\topenbd_title\tcandidate_ids\n")
        for r in conflict:
            f.write(f"{r['isbn']}\t{r['title']}\t{','.join(r['candidates'])}\n")
    print(f"  衝突        : {p}  ({len(conflict):,} 件)")

    p = out_dir / "db_unmatched.tsv"
    matched_ids = set(matched.keys())
    unmatched_db = [r for r in db_rows if r["id"] not in matched_ids]
    with open(p, "w", encoding="utf-8") as f:
        f.write("manga_id\ttitle_ja\ttitle\n")
        for r in unmatched_db:
            f.write(f"{r['id']}\t{r['title_ja'] or ''}\t{r['title']}\n")
    print(f"  DB 未マッチ : {p}  ({len(unmatched_db):,} 件)")


# ══════════════════════════════════════════════════════════════════════════════
# エントリポイント
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=__doc__,
    )
    parser.add_argument(
        "--phase", choices=["clear", "match", "all"], default="all",
        help="clear=クリアのみ / match=マッチのみ / all=両方（デフォルト）"
    )
    parser.add_argument("--db-url",   default=DEFAULT_DB_URL)
    parser.add_argument("--workers",  type=int, default=3,
                        help="並列リクエスト数（デフォルト: 3）")
    parser.add_argument("--out-dir",  default="openbd_reports",
                        help="レポートの出力先（デフォルト: openbd_reports/）")
    args = parser.parse_args()

    conn = psycopg2.connect(args.db_url)
    try:
        if args.phase in ("clear", "all"):
            phase_clear(conn)

        if args.phase in ("match", "all"):
            updated = phase_match(conn, args.workers, Path(args.out_dir))
            print(f"\n{'='*55}")
            print(f"  完了: {updated:,} 件を OpenBD データで更新")
            print(f"\n  次のステップ:")
            print(f"    python backend/scripts/fetch_rakuten_links.py \\")
            print(f"      --app-id APP_ID --access-key KEY \\")
            print(f"      --affiliate-id AFF_ID \\")
            print(f"      --origin https://your-site.example.com")
            print(f"{'='*55}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
