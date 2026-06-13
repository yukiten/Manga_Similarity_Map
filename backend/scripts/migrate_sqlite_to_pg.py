"""
SQLite (community.db) → PostgreSQL 移行スクリプト
===================================================
既存の community.db のデータを PostgreSQL に転送します。
一度だけ実行してください。

Usage:
    python -m backend.scripts.migrate_sqlite_to_pg
    # または
    cd backend && python scripts/migrate_sqlite_to_pg.py
"""

import os
import sqlite3
from pathlib import Path

import psycopg2
import psycopg2.extras

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/mangamap")
DB_FILE = Path(__file__).parent.parent / "data" / "community.db"

TABLES = [
    # 親テーブルを先に移行（FK依存関係の順）
    "users",             # user_sessions / favorites / viewed の親
    "user_sessions",     # users に依存
    "reviews",           # manga に依存（manga は PostgreSQL 側に既存）
    "community_tags",    # manga に依存
    "default_tag_votes", # manga に依存
    "next_reads",        # manga に依存
    "user_favorites",    # users + manga に依存
    "user_viewed",       # users + manga に依存
]


def migrate():
    if not DB_FILE.exists():
        print(f"SQLite DB が見つかりません: {DB_FILE}")
        print("移行するデータがないため終了します。")
        return

    sq = sqlite3.connect(DB_FILE)
    sq.row_factory = sqlite3.Row
    pg = psycopg2.connect(DATABASE_URL)
    pg.autocommit = False
    pg_cur = pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    total = 0
    for table in TABLES:
        # テーブルが SQLite に存在するか確認
        exists = sq.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            print(f"  [{table}] テーブルなし → スキップ")
            continue

        rows = sq.execute(f"SELECT * FROM {table}").fetchall()
        if not rows:
            print(f"  [{table}] 0件 → スキップ")
            continue

        cols = rows[0].keys()
        placeholders = ", ".join(["%s"] * len(cols))
        col_names = ", ".join(cols)
        inserted = 0

        for row in rows:
            try:
                pg_cur.execute(
                    f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) "
                    f"ON CONFLICT DO NOTHING",
                    tuple(row)
                )
                if pg_cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                print(f"  [{table}] 行スキップ: {e}")

        print(f"  [{table}] {inserted}/{len(rows)} 件移行")
        total += inserted

    pg.commit()
    sq.close()
    pg.close()
    print(f"\n完了: 合計 {total} 件を PostgreSQL に移行しました。")
    print("community.db は手動で削除して構いません。")


if __name__ == "__main__":
    migrate()
