import os
"""
title_ja なし作品を除外するスクリプト
======================================
1. merged.json  から title_ja が空の作品を除外（バックアップ付き）
2. manga_map.json の neighbors リストを整合
3. PostgreSQL から該当作品を DELETE（CASCADE で関連テーブルも削除）
4. バックエンドのメモリキャッシュを無効化

使い方:
    python backend/scripts/filter_no_title_ja.py [--dry-run] [--db-url URL]
"""

import argparse
import json
import shutil
from datetime import datetime
from pathlib import Path

import psycopg2
import psycopg2.extras

SCRIPT_DIR  = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent
BASE_DIR    = BACKEND_DIR.parent

MERGED_FILE    = BACKEND_DIR / "data" / "merged.json"
MAP_FILE       = BASE_DIR / "frontend" / "public" / "manga_map.json"
OUTPUT_MAP     = BACKEND_DIR / "output" / "manga_map.json"

DEFAULT_DB_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")


def backup(path: Path) -> Path:
    ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
    bak   = path.with_suffix(f".bak_{ts}.json")
    shutil.copy(path, bak)
    print(f"  バックアップ: {bak.name}")
    return bak


def load_json(path: Path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path: Path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(f"  保存: {path}  ({len(data):,} 件)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="変更をコミットせず確認のみ")
    parser.add_argument("--db-url", default=DEFAULT_DB_URL)
    args = parser.parse_args()

    # ── 1. merged.json フィルタ ──────────────────────────────────────────────
    print("\n[1/4] merged.json フィルタ")
    merged = load_json(MERGED_FILE)
    before = len(merged)
    removed_ids = {m["id"] for m in merged if not m.get("title_ja")}
    filtered_merged = [m for m in merged if m.get("title_ja")]
    after = len(filtered_merged)
    print(f"  除外件数: {before - after:,}  ({before:,} → {after:,})")
    if removed_ids:
        samples = list(removed_ids)[:5]
        print(f"  除外ID例: {samples}")

    if not args.dry_run:
        backup(MERGED_FILE)
        save_json(MERGED_FILE, filtered_merged)

    # ── 2. manga_map.json フィルタ + neighbors 整合 ─────────────────────────
    print("\n[2/4] manga_map.json フィルタ + neighbors 整合")
    map_data = load_json(MAP_FILE)
    map_before = len(map_data)
    filtered_map = [m for m in map_data if m.get("title_ja")]
    map_after = len(filtered_map)
    print(f"  除外件数: {map_before - map_after:,}  ({map_before:,} → {map_after:,})")

    # neighbors リストから削除されたIDを除去
    removed_map_ids = {m["id"] for m in map_data if not m.get("title_ja")}
    nb_cleaned = 0
    for m in filtered_map:
        orig = m.get("neighbors", [])
        cleaned = [nid for nid in orig if nid not in removed_map_ids]
        if len(cleaned) != len(orig):
            nb_cleaned += len(orig) - len(cleaned)
            m["neighbors"] = cleaned
    print(f"  neighbors から除去した参照: {nb_cleaned:,} 件")

    if not args.dry_run:
        backup(MAP_FILE)
        save_json(MAP_FILE, filtered_map)
        # output/ にも保存（import_manga.py 用）
        OUTPUT_MAP.parent.mkdir(exist_ok=True)
        save_json(OUTPUT_MAP, filtered_map)

    # ── 3. PostgreSQL DELETE ─────────────────────────────────────────────────
    print(f"\n[3/4] PostgreSQL から削除  ({len(removed_ids):,} 件対象)")
    if not removed_ids:
        print("  削除対象なし")
    else:
        conn = psycopg2.connect(args.db_url)
        try:
            cur = conn.cursor()
            # DB上でも title_ja が空のものをまとめて削除
            cur.execute("""
                SELECT id FROM manga
                WHERE title_ja IS NULL OR title_ja = ''
            """)
            db_targets = [r[0] for r in cur.fetchall()]
            print(f"  DB 上の対象: {len(db_targets):,} 件")

            if args.dry_run:
                print("  [dry-run] DELETE をスキップ")
            else:
                cur.execute("""
                    DELETE FROM manga
                    WHERE title_ja IS NULL OR title_ja = ''
                """)
                deleted = cur.rowcount
                print(f"  削除完了: {deleted:,} 件  (CASCADE で関連テーブルも削除)")
                conn.commit()
        finally:
            conn.close()

    # ── 4. キャッシュ無効化 ─────────────────────────────────────────────────
    print("\n[4/4] バックエンドキャッシュ無効化")
    if not args.dry_run:
        try:
            import urllib.request
            req = urllib.request.Request(
                "http://localhost:8000/api/admin/invalidate-cache",
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=3) as res:
                print(f"  OK: {res.read().decode()}")
        except Exception as e:
            print(f"  スキップ（バックエンド未起動 or エラー: {e}）")
            print("  → サーバー再起動で自動的に反映されます")

    if args.dry_run:
        print("\n[dry-run] 変更は適用されていません")
    else:
        print(f"\n完了: {before - after:,} 件を除外しました")
        print(f"  残り: {after:,} 件")


if __name__ == "__main__":
    main()
