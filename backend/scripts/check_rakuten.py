"""
楽天データ取得状況チェックスクリプト
=====================================
使い方:
    python check_rakuten.py
    python check_rakuten.py --input ../../frontend/public/manga_map.json
    python check_rakuten.py --sample 5        # サンプル表示件数を変更
    python check_rakuten.py --missing         # 未取得の作品一覧を表示
"""

import argparse
import json
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
BASE_DIR   = SCRIPT_DIR.parent

DATA_CANDIDATES = [
    BASE_DIR / "output" / "manga_map.json",
    BASE_DIR.parent / "frontend" / "public" / "manga_map.json",
    BASE_DIR / "data" / "manga_map.json",
]

RAKUTEN_FIELDS = [
    "image_url",
    "affiliate_url",
    "isbn",
    "author",
    "publisher",
    "sales_date",
    "review_average",
    "review_count",
    "synopsis_ja",
]


def find_input_file(override: str | None) -> Path:
    if override:
        p = Path(override)
        if not p.exists():
            raise FileNotFoundError(f"ファイルが見つかりません: {p}")
        return p
    for c in DATA_CANDIDATES:
        if c.exists():
            return c
    raise FileNotFoundError("manga_map.json が見つかりません。--input で指定してください。")


def has_field(manga: dict, field: str) -> bool:
    v = manga.get(field)
    if v is None or v == "":
        return False
    if isinstance(v, (int, float)) and v == 0:
        return False
    return True


def bar(count: int, total: int, width: int = 20) -> str:
    filled = round(width * count / total) if total else 0
    return "[" + "#" * filled + "." * (width - filled) + "]"


def main():
    parser = argparse.ArgumentParser(description="楽天データ取得状況チェック")
    parser.add_argument("--input",   default=None, help="manga_map.json のパス")
    parser.add_argument("--sample",  type=int, default=3, help="取得済みサンプル表示件数")
    parser.add_argument("--missing", action="store_true", help="未取得の作品一覧を表示")
    args = parser.parse_args()

    input_path = find_input_file(args.input)
    with open(input_path, encoding="utf-8") as f:
        manga_list = json.load(f)

    total = len(manga_list)

    # ── フィールド別カバレッジ集計 ────────────────────────────────────────────
    field_counts = {field: 0 for field in RAKUTEN_FIELDS}
    fetched_ids  = []
    missing_ids  = []

    for manga in manga_list:
        hit = any(has_field(manga, f) for f in RAKUTEN_FIELDS)
        if hit:
            fetched_ids.append(manga)
        else:
            missing_ids.append(manga)

        for field in RAKUTEN_FIELDS:
            if has_field(manga, field):
                field_counts[field] += 1

    fetched = len(fetched_ids)
    missing = len(missing_ids)

    print(f"\n{'='*55}")
    print(f"  ファイル : {input_path}")
    print(f"  総作品数 : {total:,} 件")
    print(f"{'='*55}")

    # ── 全体カバレッジ ─────────────────────────────────────────────────────────
    pct = fetched / total * 100 if total else 0
    print(f"\n【取得状況】")
    print(f"  取得済み : {fetched:>5,} 件 ({pct:.1f}%)")
    print(f"  未取得   : {missing:>5,} 件 ({100-pct:.1f}%)")

    # ── フィールド別カバレッジ ─────────────────────────────────────────────────
    print(f"\n【フィールド別カバレッジ】")
    print(f"  {'フィールド':<16} {'件数':>6}  {'割合':>6}  グラフ")
    print(f"  {'-'*52}")
    for field in RAKUTEN_FIELDS:
        cnt = field_counts[field]
        p   = cnt / total * 100 if total else 0
        print(f"  {field:<16} {cnt:>6,}  {p:>5.1f}%  {bar(cnt, total)}")

    # ── 取得済みサンプル ───────────────────────────────────────────────────────
    if fetched_ids and args.sample > 0:
        print(f"\n【取得済みサンプル（{args.sample}件）】")
        for manga in fetched_ids[: args.sample]:
            title = manga.get("title_ja") or manga.get("title", "")
            print(f"\n  ▸ {title}")
            print(f"    isbn        : {manga.get('isbn', '—')}")
            print(f"    author      : {manga.get('author', '—')}")
            print(f"    publisher   : {manga.get('publisher', '—')}")
            print(f"    sales_date  : {manga.get('sales_date', '—')}")
            print(f"    review_avg  : {manga.get('review_average', '—')}  ({manga.get('review_count', 0)}件)")
            img = manga.get("image_url", "")
            print(f"    image_url   : {'あり (' + img[:60] + '...)' if img else '—'}")
            aff = manga.get("affiliate_url", "")
            print(f"    affiliate   : {'あり' if aff else '—'}")

    # ── 未取得一覧 ─────────────────────────────────────────────────────────────
    if args.missing:
        print(f"\n【未取得の作品一覧（{missing}件）】")
        for manga in missing_ids:
            title = manga.get("title_ja") or manga.get("title", "")
            mid   = manga.get("slug") or manga.get("id", "")
            print(f"  {mid:<30} {title}")

    print(f"\n{'='*55}\n")


if __name__ == "__main__":
    main()
