import os
"""
OpenBD スナップショットからコミック情報を一括取得するスクリプト
=============================================================
OpenBD の全件スナップショット (https://api.openbd.jp/v1/snapshot) を
ストリーミング取得・解析し、コミック（C-code *79 / NDC 726-727）に絞って処理する。

取得できる情報:
    isbn / title / author / publisher / pubdate(発売日)
    cover_url(表紙画像) / synopsis(あらすじ) / c_code / ndc / volume

━━ モード ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  enrich  (デフォルト)
    DB の manga テーブルで isbn が一致するレコードに
    synopsis_ja / image_url / author / publisher / sales_date を補完する。
    すでに値があるフィールドは上書きしない (COALESCE)。

  export
    フィルタ済みのコミックデータを JSONL ファイルに書き出す。
    後続の import_manga.py や外部ツールで利用可能。

  count
    フィルタ件数を表示するだけ（DB・ファイルへの書き込みなし）。

━━ 使い方 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  # DB の既存作品に synopsis_ja などを補完（推奨）
  python backend/scripts/fetch_openbd_snapshot.py --mode enrich

  # 第1巻のみ補完
  python backend/scripts/fetch_openbd_snapshot.py --mode enrich --v1-only

  # 全コミックを JSONL に書き出し
  python backend/scripts/fetch_openbd_snapshot.py --mode export --out openbd_comics.jsonl

  # 第1巻のみ書き出し
  python backend/scripts/fetch_openbd_snapshot.py --mode export --v1-only --out openbd_v1.jsonl

  # 件数確認だけ
  python backend/scripts/fetch_openbd_snapshot.py --mode count

  # ローカルにキャッシュ済みのスナップショットを使う
  python backend/scripts/fetch_openbd_snapshot.py --mode enrich --snapshot ./openbd_snapshot.gz
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

注意: スナップショットは非圧縮で 5〜10 GB 程度。ダウンロードに数十分かかる場合があります。
      --snapshot オプションで既存の .gz ファイルを指定するとダウンロードをスキップできます。
"""

import argparse
import gzip
import re
import sys
import time
from pathlib import Path

import psycopg2
import psycopg2.extras
import requests

try:
    import ijson
    _HAS_IJSON = True
except ImportError:
    _HAS_IJSON = False

SNAPSHOT_URL   = "https://api.openbd.jp/v1/snapshot"
DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")
CHUNK_SIZE     = 1 << 20   # 1 MiB
DB_BATCH_SIZE  = 500


# ── C-code / NDC でコミック判定 ──────────────────────────────────────────────

def _subjects(onix: dict) -> list[dict]:
    try:
        return onix["DescriptiveDetail"]["Subject"] or []
    except (KeyError, TypeError):
        return []


def _is_comic(onix: dict) -> bool:
    """C-code が *79（コミック・劇画）または NDC 726/727 ならコミックと判定"""
    for s in _subjects(onix):
        sid  = str(s.get("SubjectSchemeIdentifier", ""))
        code = str(s.get("SubjectCode", "")).zfill(4)
        if sid == "20" and code.endswith("79"):          # Cコード コミック
            return True
        if sid in ("78", "80") and re.match(r"72[67]", code):  # NDC 726/727
            return True
    return False


def _c_code(onix: dict) -> str | None:
    for s in _subjects(onix):
        if str(s.get("SubjectSchemeIdentifier", "")) == "20":
            return str(s.get("SubjectCode", "")).zfill(4)
    return None


def _ndc(onix: dict) -> str | None:
    for s in _subjects(onix):
        if str(s.get("SubjectSchemeIdentifier", "")) in ("78", "80"):
            return str(s.get("SubjectCode", ""))
    return None


# ── 巻数抽出 ─────────────────────────────────────────────────────────────────

_VOL_RE = re.compile(
    r'[\s　（(【\[第]([0-9１-９]{1,3})[\s　）)】\]巻]'
    r'|[\s　]([0-9１-９]{1,3})\s*$'
)
_ZENKAKU = str.maketrans("１２３４５６７８９０", "1234567890")


def _volume(title: str) -> int | None:
    m = _VOL_RE.search(title)
    if m:
        raw = (m.group(1) or m.group(2) or "").translate(_ZENKAKU)
        try:
            return int(raw)
        except ValueError:
            pass
    return None


# ── あらすじ抽出 ─────────────────────────────────────────────────────────────

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


# ── 1件分のデータ抽出 ────────────────────────────────────────────────────────

def extract(item: dict) -> dict | None:
    """None → コミック以外、または isbn なし"""
    if not item:
        return None

    onix    = item.get("onix") or {}
    summary = item.get("summary") or {}

    if not _is_comic(onix):
        return None

    isbn = (summary.get("isbn") or "").strip()
    if not isbn:
        return None

    title     = (summary.get("title")     or "").strip()
    author    = (summary.get("author")    or "").strip()
    publisher = (summary.get("publisher") or "").strip()
    pubdate   = (summary.get("pubdate")   or "").strip()
    cover_url = (summary.get("cover")     or "").strip()
    synopsis  = _synopsis(item)
    vol       = _volume(title)

    return {
        "isbn":      isbn,
        "title":     title,
        "author":    author,
        "publisher": publisher,
        "pubdate":   pubdate,       # YYYYMMDD
        "cover_url": cover_url,
        "synopsis":  synopsis,
        "c_code":    _c_code(onix),
        "ndc":       _ndc(onix),
        "volume":    vol,
    }


# ── ストリーミング解析 ────────────────────────────────────────────────────────

def iter_comics(stream, v1_only: bool):
    """
    gzip ストリームを解析してコミックを yield する。
    ijson があれば省メモリ、なければ全展開 (メモリ注意)。
    """
    if _HAS_IJSON:
        yield from _iter_ijson(stream, v1_only)
    else:
        yield from _iter_stdlib(stream, v1_only)


def _iter_ijson(stream, v1_only: bool):
    import ijson
    total = hit = skip = 0
    t0 = time.time()
    for item in ijson.items(stream, "item"):
        total += 1
        rec = extract(item)
        if rec is None:
            continue
        if v1_only and rec["volume"] not in (None, 1):
            skip += 1
            continue
        hit += 1
        if total % 100_000 == 0:
            elapsed = time.time() - t0
            print(f"  {total:>8,} 件処理  コミック {hit:,} 件  ({elapsed:.0f}s)", flush=True)
        yield rec
    print(f"  完了: 総数 {total:,} 件 / コミック {hit:,} 件 / v1以外除外 {skip:,} 件")


def _iter_stdlib(stream, v1_only: bool):
    """ijson なし: 全展開して処理（メモリ 数 GB 消費）"""
    import json
    print("  [警告] ijson 未インストール。全データをメモリに展開します (数 GB)。")
    print("  推奨: pip install ijson")
    data = json.loads(stream.read())
    total = hit = skip = 0
    for item in data:
        total += 1
        rec = extract(item)
        if rec is None:
            continue
        if v1_only and rec["volume"] not in (None, 1):
            skip += 1
            continue
        hit += 1
        yield rec
    print(f"  完了: 総数 {total:,} 件 / コミック {hit:,} 件 / v1以外除外 {skip:,} 件")


# ── ダウンロード ──────────────────────────────────────────────────────────────

def open_snapshot(snapshot_path: Path | None):
    """
    snapshot_path が指定されていればファイルを開く。
    なければ HTTP でダウンロードしてストリームを返す。
    どちらも gzip 展開済みのバイナリストリームを返す。
    """
    if snapshot_path and snapshot_path.exists():
        print(f"キャッシュを使用: {snapshot_path}")
        return gzip.open(snapshot_path, "rb")

    print(f"スナップショットをダウンロード中: {SNAPSHOT_URL}")
    print("（数十分かかる場合があります。Ctrl+C で中断可）")
    resp = requests.get(SNAPSHOT_URL, stream=True, timeout=600)
    resp.raise_for_status()

    total_bytes = int(resp.headers.get("Content-Length", 0))
    downloaded  = 0
    t0 = time.time()

    # メモリ効率のため一時ファイルに書き出してから開く
    tmp = Path("openbd_snapshot_tmp.gz")
    try:
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                f.write(chunk)
                downloaded += len(chunk)
                if total_bytes:
                    pct = downloaded / total_bytes * 100
                    mb  = downloaded / 1e6
                    sys.stdout.write(f"\r  {mb:.0f} MB / {total_bytes/1e6:.0f} MB  ({pct:.1f}%)")
                    sys.stdout.flush()
        print(f"\n  ダウンロード完了 ({(time.time()-t0):.0f}s)")
        return gzip.open(tmp, "rb")
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


# ── DB 更新 (enrich モード) ───────────────────────────────────────────────────

UPDATE_SQL = """
    UPDATE manga SET
        synopsis_ja  = CASE WHEN (synopsis_ja  IS NULL OR synopsis_ja  = '') AND %s <> '' THEN %s ELSE synopsis_ja  END,
        image_url    = CASE WHEN (image_url    IS NULL OR image_url    = '') AND %s <> '' THEN %s ELSE image_url    END,
        author       = CASE WHEN (author       IS NULL OR author       = '') AND %s <> '' THEN %s ELSE author       END,
        publisher    = CASE WHEN (publisher    IS NULL OR publisher    = '') AND %s <> '' THEN %s ELSE publisher    END,
        sales_date   = CASE WHEN (sales_date   IS NULL OR sales_date   = '') AND %s <> '' THEN %s ELSE sales_date   END
    WHERE isbn = %s
"""


def run_enrich(conn, v1_only: bool, snapshot_path: Path | None):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # DB の isbn セット（存在チェック用）
    cur.execute("SELECT isbn FROM manga WHERE isbn IS NOT NULL AND isbn <> ''")
    db_isbns = {r["isbn"] for r in cur.fetchall()}
    print(f"DB の isbn 保有作品: {len(db_isbns):,} 件\n")

    stream = open_snapshot(snapshot_path)
    print("\nコミック解析中...\n")

    batch  = []
    total  = matched = 0

    plain_cur = conn.cursor()

    for rec in iter_comics(stream, v1_only):
        total += 1
        if rec["isbn"] not in db_isbns:
            continue

        batch.append((
            rec["synopsis"],  rec["synopsis"],
            rec["cover_url"], rec["cover_url"],
            rec["author"],    rec["author"],
            rec["publisher"], rec["publisher"],
            rec["pubdate"],   rec["pubdate"],
            rec["isbn"],
        ))

        if len(batch) >= DB_BATCH_SIZE:
            for params in batch:
                plain_cur.execute(UPDATE_SQL, params)
            conn.commit()
            matched += len(batch)
            print(f"  DB 更新: {matched:,} 件（処理中 {total:,} 件）", flush=True)
            batch = []

    # 残り
    if batch:
        for params in batch:
            plain_cur.execute(UPDATE_SQL, params)
        conn.commit()
        matched += len(batch)

    print(f"\n{'='*55}")
    print(f"  コミック総数       : {total:,} 件")
    print(f"  ISBN マッチ・更新  : {matched:,} 件")
    print(f"{'='*55}")


# ── エクスポート (export モード) ──────────────────────────────────────────────

def run_export(out_path: Path, v1_only: bool, snapshot_path: Path | None):
    import json

    stream = open_snapshot(snapshot_path)
    print(f"\nコミック解析中 → {out_path}\n")

    written = 0
    with open(out_path, "w", encoding="utf-8") as f:
        for rec in iter_comics(stream, v1_only):
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            written += 1

    size_mb = out_path.stat().st_size / 1e6
    print(f"\n{'='*55}")
    print(f"  書き出し: {written:,} 件  →  {out_path}  ({size_mb:.1f} MB)")
    print(f"{'='*55}")


# ── カウントのみ (count モード) ────────────────────────────────────────────────

def run_count(v1_only: bool, snapshot_path: Path | None):
    stream = open_snapshot(snapshot_path)
    print("\nコミック件数をカウント中...\n")
    count = sum(1 for _ in iter_comics(stream, v1_only))
    label = "（第1巻のみ）" if v1_only else "（全巻）"
    print(f"\nコミック {label}: {count:,} 件")


# ── エントリポイント ──────────────────────────────────────────────────────────

def main():
    if not _HAS_IJSON:
        print("[警告] ijson がインストールされていません。")
        print("      大量メモリが必要になります。推奨: pip install ijson\n")

    parser = argparse.ArgumentParser(
        formatter_class=argparse.RawDescriptionHelpFormatter,
        description=__doc__,
    )
    parser.add_argument(
        "--mode", choices=["enrich", "export", "count"], default="enrich",
        help="enrich=DB補完 / export=ファイル出力 / count=件数確認のみ"
    )
    parser.add_argument("--db-url",    default=DEFAULT_DB_URL)
    parser.add_argument("--snapshot",  default=None,
                        help="ローカルのスナップショット .gz ファイルパス（省略時はダウンロード）")
    parser.add_argument("--out",       default="openbd_comics.jsonl",
                        help="export モードの出力ファイルパス（デフォルト: openbd_comics.jsonl）")
    parser.add_argument("--v1-only",   action="store_true",
                        help="第1巻（または巻数不明）のみ処理する")
    args = parser.parse_args()

    snap = Path(args.snapshot) if args.snapshot else None

    if args.mode == "enrich":
        print("=== モード: enrich（DB 補完）===\n")
        conn = psycopg2.connect(args.db_url)
        try:
            run_enrich(conn, args.v1_only, snap)
        finally:
            conn.close()

    elif args.mode == "export":
        print("=== モード: export（JSONL 書き出し）===\n")
        run_export(Path(args.out), args.v1_only, snap)

    elif args.mode == "count":
        print("=== モード: count（件数確認）===\n")
        run_count(args.v1_only, snap)


if __name__ == "__main__":
    main()
