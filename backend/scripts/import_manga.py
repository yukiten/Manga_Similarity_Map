import os
"""
manga_map.json → PostgreSQL インポートスクリプト
================================================
何度実行しても安全（UPSERT方式）。
楽天データ取得中でも実行可。取得完了後に再実行すれば更新される。

使い方:
    python backend/scripts/import_manga.py
    python backend/scripts/import_manga.py --db-url $DATABASE_URL
"""

import argparse
import json
import time
from pathlib import Path

import psycopg2
import psycopg2.extras

SCRIPT_DIR = Path(__file__).parent
BASE_DIR   = SCRIPT_DIR.parent

DATA_CANDIDATES = [
    BASE_DIR.parent / "frontend" / "public" / "manga_map.json",
    BASE_DIR / "output" / "manga_map.json",
]

TAG_IDF_CANDIDATES = [
    BASE_DIR.parent / "frontend" / "public" / "tag_idf.json",
]

DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")
BATCH_SIZE = 500


def find_file(candidates):
    for p in candidates:
        if p.exists():
            return p
    raise FileNotFoundError(f"ファイルが見つかりません: {candidates}")


def import_manga(conn, manga_list):
    cur = conn.cursor()
    total = len(manga_list)
    print(f"\n[1/3] マンガデータ インポート中... ({total:,}件)")

    manga_rows = []
    tag_rows   = []
    nbr_rows   = []

    for manga in manga_list:
        manga_rows.append((
            manga.get("id", ""),
            manga.get("slug") or manga.get("id", ""),
            manga.get("title", ""),
            manga.get("title_ja"),
            manga.get("title_romaji"),
            manga.get("x"),
            manga.get("y"),
            manga.get("z"),
            manga.get("cluster_id"),
            manga.get("genre"),
            manga.get("synopsis"),
            manga.get("synopsis_ja") or None,
            manga.get("popularity", 1),
            manga.get("score"),
            manga.get("year"),
            manga.get("cover") or manga.get("cover_url"),
            manga.get("url"),
            manga.get("image_url"),
            manga.get("affiliate_url"),
            manga.get("isbn"),
            manga.get("author"),
            manga.get("publisher"),
            manga.get("sales_date"),
            str(manga.get("review_average", "")) or None,
            manga.get("review_count") or 0,
        ))

        mid = manga.get("id", "")
        seen_tags = {}
        for tag in manga.get("tags", []):
            if isinstance(tag, dict):
                name = tag.get("name", "")
                if not name:
                    continue
                # 同一(manga_id, tag_name)が複数ある場合はrankが高い方を採用
                if name not in seen_tags or tag.get("rank", 0) > seen_tags[name][1]:
                    seen_tags[name] = (
                        mid, tag.get("rank", 0), tag.get("spoiler", False)
                    )
        for name, (mid2, rank, spoiler) in seen_tags.items():
            tag_rows.append((mid2, name, rank, spoiler))

        for pos, nbr_id in enumerate(manga.get("neighbors", []), start=1):
            nbr_rows.append((mid, nbr_id, pos))

    # manga テーブル UPSERT
    upsert_manga = """
        INSERT INTO manga (
            id, slug, title, title_ja, title_romaji,
            x, y, z, cluster_id, genre,
            synopsis, synopsis_ja, popularity, score, year,
            cover, url,
            image_url, affiliate_url, isbn,
            author, publisher, sales_date, review_average, review_count
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            slug           = EXCLUDED.slug,
            title          = EXCLUDED.title,
            title_ja       = EXCLUDED.title_ja,
            title_romaji   = EXCLUDED.title_romaji,
            x              = EXCLUDED.x,
            y              = EXCLUDED.y,
            z              = EXCLUDED.z,
            cluster_id     = EXCLUDED.cluster_id,
            genre          = EXCLUDED.genre,
            synopsis       = EXCLUDED.synopsis,
            synopsis_ja    = EXCLUDED.synopsis_ja,
            popularity     = EXCLUDED.popularity,
            score          = EXCLUDED.score,
            year           = EXCLUDED.year,
            cover          = EXCLUDED.cover,
            url            = EXCLUDED.url,
            image_url      = COALESCE(EXCLUDED.image_url,      manga.image_url),
            affiliate_url  = COALESCE(EXCLUDED.affiliate_url,  manga.affiliate_url),
            isbn           = COALESCE(EXCLUDED.isbn,           manga.isbn),
            author         = COALESCE(EXCLUDED.author,         manga.author),
            publisher      = COALESCE(EXCLUDED.publisher,      manga.publisher),
            sales_date     = COALESCE(EXCLUDED.sales_date,     manga.sales_date),
            review_average = COALESCE(EXCLUDED.review_average, manga.review_average),
            review_count   = COALESCE(EXCLUDED.review_count,   manga.review_count)
    """

    # バッチ処理
    for i in range(0, len(manga_rows), BATCH_SIZE):
        batch = manga_rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_values(cur, upsert_manga, batch)
        print(f"  manga: {min(i + BATCH_SIZE, total):>6,} / {total:,}", end="\r")
    print(f"  manga: {total:,} / {total:,} 完了")
    conn.commit()

    # manga_tags UPSERT
    print(f"\n[2/3] タグ インポート中... ({len(tag_rows):,}件)")
    upsert_tags = """
        INSERT INTO manga_tags (manga_id, tag_name, rank, spoiler)
        VALUES %s
        ON CONFLICT (manga_id, tag_name) DO UPDATE SET
            rank    = EXCLUDED.rank,
            spoiler = EXCLUDED.spoiler
    """
    for i in range(0, len(tag_rows), BATCH_SIZE):
        batch = tag_rows[i:i + BATCH_SIZE]
        psycopg2.extras.execute_values(cur, upsert_tags, batch)
        print(f"  tags: {min(i + BATCH_SIZE, len(tag_rows)):>8,} / {len(tag_rows):,}", end="\r")
    print(f"  tags: {len(tag_rows):,} / {len(tag_rows):,} 完了")
    conn.commit()

    # manga_neighbors UPSERT（既存IDのみ）
    print(f"\n[3/3] 近傍リスト インポート中... ({len(nbr_rows):,}件)")
    upsert_nbr = """
        INSERT INTO manga_neighbors (manga_id, neighbor_id, position)
        VALUES %s
        ON CONFLICT (manga_id, neighbor_id) DO UPDATE SET
            position = EXCLUDED.position
    """
    # 存在しないneighbor_idは除外（外部キー制約）
    valid_ids = {r[0] for r in manga_rows}
    nbr_rows  = [r for r in nbr_rows if r[1] in valid_ids]

    for i in range(0, len(nbr_rows), BATCH_SIZE):
        batch = nbr_rows[i:i + BATCH_SIZE]
        try:
            psycopg2.extras.execute_values(cur, upsert_nbr, batch)
        except Exception:
            conn.rollback()
        print(f"  neighbors: {min(i + BATCH_SIZE, len(nbr_rows)):>8,} / {len(nbr_rows):,}", end="\r")
    print(f"  neighbors: {len(nbr_rows):,} / {len(nbr_rows):,} 完了")
    conn.commit()

    cur.close()


def import_tag_idf(conn, idf_path):
    print(f"\n[+] tag_idf インポート中...")
    with open(idf_path, encoding="utf-8") as f:
        idf = json.load(f)

    cur = conn.cursor()
    rows = [(name, score, 0) for name, score in idf.items()]
    psycopg2.extras.execute_values(cur, """
        INSERT INTO tag_idf (tag_name, idf_score, doc_count)
        VALUES %s
        ON CONFLICT (tag_name) DO UPDATE SET
            idf_score = EXCLUDED.idf_score
    """, rows)
    conn.commit()
    cur.close()
    print(f"  {len(rows):,}タグ 完了")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL接続URL")
    parser.add_argument("--input",  default=None,           help="manga_map.jsonのパス")
    args = parser.parse_args()

    input_path = Path(args.input) if args.input else find_file(DATA_CANDIDATES)
    print(f"入力ファイル: {input_path}")

    print("PostgreSQL に接続中...")
    conn = psycopg2.connect(args.db_url)
    print("接続成功")

    print(f"manga_map.json 読み込み中...")
    t0 = time.time()
    with open(input_path, encoding="utf-8") as f:
        manga_list = json.load(f)
    print(f"  {len(manga_list):,}件 ({time.time()-t0:.1f}秒)")

    import_manga(conn, manga_list)

    try:
        idf_path = find_file(TAG_IDF_CANDIDATES)
        import_tag_idf(conn, idf_path)
    except FileNotFoundError:
        print("  tag_idf.json が見つからないためスキップ")

    conn.close()

    print(f"\n{'='*50}")
    print(f"完了: {len(manga_list):,}件をインポートしました")
    print(f"楽天データ取得完了後に再実行すると自動更新されます")
    print(f"{'='*50}\n")


if __name__ == "__main__":
    main()
