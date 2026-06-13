"""
Manga Map FastAPI Backend v2
============================
全データ: PostgreSQL に統合（SQLite 廃止）

Usage:
    pip install fastapi uvicorn psycopg2-binary
    uvicorn backend.main:app --reload --port 8000
"""

from pathlib import Path as _Path
from dotenv import load_dotenv
load_dotenv(_Path(__file__).parent.parent / ".env")

import hashlib
import json as _json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
import psycopg2.pool
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from brotli_asgi import BrotliMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

# ── 設定 ──────────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "")
SITE_URL     = os.getenv("SITE_URL", "https://your-domain.com").rstrip("/")
DIST_DIR     = Path(__file__).parent.parent / "frontend" / "dist"

CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://localhost:3000",
).split(",")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not DATABASE_URL:
        raise RuntimeError("環境変数 DATABASE_URL が設定されていません")
    init_db()
    yield


limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Manga Map API", version="2.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(BrotliMiddleware, minimum_size=1000, quality=4)
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── マップデータのメモリキャッシュ（1時間TTL）──────────────────────────────────
_map_cache: dict[str, Any] = {"data": None, "ts": 0.0}
MAP_CACHE_TTL = 3600


_pg_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _init_pool():
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=2, maxconn=20, dsn=DATABASE_URL
        )


def get_pg():
    """PostgreSQL接続（プールから取得）"""
    _init_pool()
    conn = _pg_pool.getconn()
    conn.autocommit = False
    return conn


def put_pg(conn):
    """PostgreSQL接続をプールに返却"""
    if _pg_pool and conn:
        try:
            conn.rollback()
        except Exception:
            pass
        _pg_pool.putconn(conn)


# ── パスワードハッシュ（pbkdf2_hmac, 標準ライブラリのみ） ──────────────────────

SESSION_EXPIRE_DAYS = 30


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)                                       # 16バイトのランダムバイト列
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260_000)
    return f"pbkdf2:sha256:{salt.hex()}:{dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        _, algo, salt_hex, dk_hex = stored.split(":")
        salt = bytes.fromhex(salt_hex)                                   # hex文字列→バイト列に復元
        dk = hashlib.pbkdf2_hmac(algo, password.encode(), salt, 260_000)
        return secrets.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False


def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="認証が必要です")
    token = authorization[7:]
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "SELECT s.user_id, u.username FROM user_sessions s "
            "JOIN users u ON s.user_id = u.id "
            "WHERE s.token = %s AND s.expires_at > %s",
            (token, now),
        )
        row = cur.fetchone()
    finally:
        put_pg(conn)
    if not row:
        raise HTTPException(status_code=401, detail="無効または期限切れのトークンです")
    return {"user_id": row["user_id"], "username": row["username"]}


def _resolve_optional_user(authorization: Optional[str]) -> Optional[dict]:
    """トークンが有効なら user dict を返す。未ログインや無効なら None。"""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "SELECT s.user_id, u.username FROM user_sessions s "
            "JOIN users u ON s.user_id = u.id "
            "WHERE s.token = %s AND s.expires_at > %s",
            (token, now),
        )
        row = cur.fetchone()
    finally:
        put_pg(conn)
    return {"user_id": row["user_id"], "username": row["username"]} if row else None


# ── 起動時: テーブル初期化（マンガ系は init_db.sql 参照） ────────────────────────
def init_db():
    conn = get_pg()
    try:
        cur = conn.cursor()

        # ── テーブル作成（新規インストール用、FK制約名を明示） ─────────────────
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                token      TEXT PRIMARY KEY,
                user_id    TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                CONSTRAINT fk_user_sessions_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_favorites (
                user_id    TEXT NOT NULL,
                manga_id   TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(user_id, manga_id),
                CONSTRAINT fk_user_favorites_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_user_favorites_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_viewed (
                user_id    TEXT NOT NULL,
                manga_id   TEXT NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY(user_id, manga_id),
                CONSTRAINT fk_user_viewed_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_user_viewed_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                id         TEXT PRIMARY KEY,
                manga_id   TEXT NOT NULL,
                author     TEXT NOT NULL DEFAULT '匿名',
                rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                CONSTRAINT fk_reviews_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS community_tags (
                id         TEXT PRIMARY KEY,
                manga_id   TEXT NOT NULL,
                tag_name   TEXT NOT NULL,
                upvotes    INTEGER NOT NULL DEFAULT 1,
                downvotes  INTEGER NOT NULL DEFAULT 0,
                strength   INTEGER NOT NULL DEFAULT 50,
                created_at TEXT NOT NULL,
                UNIQUE(manga_id, tag_name),
                CONSTRAINT fk_community_tags_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS default_tag_votes (
                manga_id   TEXT NOT NULL,
                tag_name   TEXT NOT NULL,
                upvotes    INTEGER NOT NULL DEFAULT 0,
                downvotes  INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(manga_id, tag_name),
                CONSTRAINT fk_default_tag_votes_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS next_reads (
                id            TEXT PRIMARY KEY,
                from_manga_id TEXT NOT NULL,
                to_manga_id   TEXT NOT NULL,
                comment       TEXT NOT NULL DEFAULT '',
                votes         INTEGER NOT NULL DEFAULT 1,
                created_at    TEXT NOT NULL,
                UNIQUE(from_manga_id, to_manga_id),
                CONSTRAINT fk_next_reads_from FOREIGN KEY (from_manga_id) REFERENCES manga(id) ON DELETE CASCADE,
                CONSTRAINT fk_next_reads_to   FOREIGN KEY (to_manga_id)   REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS synopsis_translations (
                id         TEXT PRIMARY KEY,
                manga_id   TEXT NOT NULL,
                language   TEXT NOT NULL DEFAULT 'ja',
                body       TEXT NOT NULL,
                author     TEXT NOT NULL DEFAULT '匿名',
                upvotes    INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                CONSTRAINT fk_synopsis_translations_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_lists (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                is_public   BOOLEAN NOT NULL DEFAULT TRUE,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL,
                CONSTRAINT fk_user_lists_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_lists_user_id ON user_lists(user_id)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_list_items (
                list_id  TEXT NOT NULL,
                manga_id TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0,
                note     TEXT NOT NULL DEFAULT '',
                added_at TEXT NOT NULL,
                PRIMARY KEY(list_id, manga_id),
                CONSTRAINT fk_user_list_items_list  FOREIGN KEY (list_id)  REFERENCES user_lists(id) ON DELETE CASCADE,
                CONSTRAINT fk_user_list_items_manga FOREIGN KEY (manga_id) REFERENCES manga(id)      ON DELETE CASCADE
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_user_list_items_manga_id ON user_list_items(manga_id)")

        # ── 既存DB向けマイグレーション: FK制約が未設定の場合のみ追加 ─────────────
        _add_fk_constraints = [
            ("fk_synopsis_translations_manga", "synopsis_translations", "manga_id", "manga(id)"),
            ("fk_reviews_manga",          "reviews",          "manga_id",      "manga(id)"),
            ("fk_community_tags_manga",   "community_tags",   "manga_id",      "manga(id)"),
            ("fk_default_tag_votes_manga","default_tag_votes","manga_id",      "manga(id)"),
            ("fk_next_reads_from",        "next_reads",       "from_manga_id", "manga(id)"),
            ("fk_next_reads_to",          "next_reads",       "to_manga_id",   "manga(id)"),
            ("fk_user_sessions_users",    "user_sessions",    "user_id",       "users(id)"),
            ("fk_user_favorites_users",   "user_favorites",   "user_id",       "users(id)"),
            ("fk_user_favorites_manga",   "user_favorites",   "manga_id",      "manga(id)"),
            ("fk_user_viewed_users",      "user_viewed",      "user_id",       "users(id)"),
            ("fk_user_viewed_manga",      "user_viewed",      "manga_id",      "manga(id)"),
        ]
        for cname, table, col, ref in _add_fk_constraints:
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = %s
                    ) THEN
                        EXECUTE format(
                            'ALTER TABLE %%I ADD CONSTRAINT %%I FOREIGN KEY (%%I) REFERENCES %%s ON DELETE CASCADE',
                            %s, %s, %s, %s
                        );
                    END IF;
                END $$;
            """, (cname, table, cname, col, ref))

        # ── community_tags.strength カラム追加（既存DB向け） ───────────────────────
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='community_tags' AND column_name='strength'
                ) THEN
                    ALTER TABLE community_tags ADD COLUMN strength INTEGER NOT NULL DEFAULT 50;
                END IF;
            END $$;
        """)

        # ── user_id カラム追加（既存DB向け） ──────────────────────────────────────
        for tbl in ("reviews", "next_reads"):
            cur.execute(f"""
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name='{tbl}' AND column_name='user_id'
                    ) THEN
                        ALTER TABLE {tbl} ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
                    END IF;
                END $$;
            """)

        conn.commit()
    finally:
        put_pg(conn)


# ── Pydanticモデル ─────────────────────────────────────────────────────────────
class CommunityTagIn(BaseModel):
    tag_name: str
    strength: int = 50

class TagVoteIn(BaseModel):
    delta: int  # +1 or -1

class ReviewIn(BaseModel):
    author: str = "匿名"
    rating: int
    body: str

class NextReadIn(BaseModel):
    to_manga_id: str
    comment: str = ""

class AuthIn(BaseModel):
    username: str
    password: str

class SyncListIn(BaseModel):
    ids: list[str]

class TranslationIn(BaseModel):
    language: str = "ja"
    body: str
    author: str = "匿名"

class ListCreateIn(BaseModel):
    name: str
    description: str = ""
    is_public: bool = True

class ListUpdateIn(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_public: Optional[bool] = None

class ListItemIn(BaseModel):
    manga_id: str
    note: str = ""


# ── ヘルパー ───────────────────────────────────────────────────────────────────
def resolve_manga_id(cur, manga_id: str) -> str:
    """idまたはslugからDBのidを取得"""
    cur.execute("SELECT id FROM manga WHERE id = %s OR slug = %s LIMIT 1",
                (manga_id, manga_id))
    row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Manga not found")
    return row["id"]


# ══════════════════════════════════════════════════════════════════════════════
# マンガカタログ API
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/manga/map")
def get_map_data(request: Request):
    """
    マップ描画用データ（全件）。
    タグ・近傍IDを含む。あらすじ・楽天詳細は含まない（選択時に個別取得）。
    初回はDBから構築し、以降はメモリキャッシュから返す。
    """
    now = time.time()
    _cache_headers = {"Cache-Control": "public, max-age=3600"}

    if _map_cache["data"] is not None and now - _map_cache["ts"] < MAP_CACHE_TTL:
        return Response(
            content=_map_cache.get("json_bytes") or _json.dumps(_map_cache["data"], ensure_ascii=False, separators=(",", ":")),
            media_type="application/json",
            headers=_cache_headers,
        )

    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        cur.execute("""
            SELECT id, slug, title, title_ja, title_romaji,
                   x, y, z, cluster_id, genre, popularity, score, year,
                   cover, image_url
            FROM manga ORDER BY id
        """)
        mangas = [dict(r) for r in cur.fetchall()]
        index  = {m["id"]: m for m in mangas}
        for m in mangas:
            m["tags"]      = []
            m["neighbors"] = []

        cur.execute("""
            SELECT manga_id, tag_name AS name, rank, spoiler
            FROM manga_tags ORDER BY manga_id, rank DESC
        """)
        for r in cur.fetchall():
            m = index.get(r["manga_id"])
            if m:
                m["tags"].append({"name": r["name"], "rank": r["rank"], "spoiler": r["spoiler"]})

        cur.execute("""
            SELECT manga_id, neighbor_id
            FROM manga_neighbors ORDER BY manga_id, position
        """)
        for r in cur.fetchall():
            m = index.get(r["manga_id"])
            if m:
                m["neighbors"].append(r["neighbor_id"])

        json_str = _json.dumps(mangas, ensure_ascii=False, separators=(",", ":"))
        _map_cache["data"] = mangas
        _map_cache["json_bytes"] = json_str
        _map_cache["ts"]   = now
        return Response(content=json_str, media_type="application/json", headers=_cache_headers)
    finally:
        put_pg(conn)


@app.post("/api/admin/invalidate-cache", include_in_schema=False)
@limiter.limit("3/minute")
def invalidate_cache(request: Request, user: dict = Depends(get_current_user)):
    # 管理者のみ（最初に登録されたユーザー = id がもっとも古い）
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM users ORDER BY created_at ASC LIMIT 1")
        first = cur.fetchone()
        if not first or first["id"] != user["user_id"]:
            raise HTTPException(403, "管理者権限が必要です")
    finally:
        put_pg(conn)
    _map_cache["data"] = None
    _map_cache["ts"]   = 0.0
    return {"ok": True}


@app.get("/api/manga/search")
def search_manga(
    q:     str = Query(..., min_length=1),
    limit: int = Query(default=20, le=100),
):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        pattern = f"%{q}%"
        cur.execute("""
            SELECT id, slug, title, title_ja, title_romaji,
                   x, y, z, cluster_id, genre, popularity, score, cover
            FROM manga
            WHERE title ILIKE %s OR title_ja ILIKE %s OR title_romaji ILIKE %s
            ORDER BY score DESC NULLS LAST
            LIMIT %s
        """, (pattern, pattern, pattern, limit))
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.get("/api/manga")
def list_manga(
    tags:           Optional[str] = Query(default=None),
    tag_mode:       str           = Query(default="OR"),
    genre:          Optional[str] = Query(default=None),
    popularity_min: int           = Query(default=1, ge=1, le=5),
    limit:          int           = Query(default=50, le=200),
    offset:         int           = Query(default=0, ge=0),
    sort:           str           = Query(default="score"),
):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        tag_list = [t.strip() for t in tags.split(",")] if tags else []
        sort_sql = {
            "score":      "score DESC NULLS LAST",
            "popularity": "popularity DESC",
            "title":      "title ASC",
        }.get(sort, "score DESC NULLS LAST")
        genre_clause = "AND genre = %s" if genre else ""

        if tag_list and tag_mode.upper() == "AND":
            params = [popularity_min]
            if genre:
                params.append(genre)
            params += [tag_list, len(tag_list), limit, offset]
            cur.execute(f"""
                SELECT id, slug, title, title_ja, x, y, z,
                       cluster_id, genre, popularity, score, cover
                FROM manga
                WHERE popularity >= %s {genre_clause}
                  AND (
                    SELECT COUNT(DISTINCT tag_name) FROM manga_tags
                    WHERE manga_id = manga.id AND tag_name = ANY(%s)
                  ) = %s
                ORDER BY {sort_sql}
                LIMIT %s OFFSET %s
            """, params)
        elif tag_list:
            params = [tag_list, popularity_min]
            if genre:
                params.append(genre)
            params += [limit, offset]
            cur.execute(f"""
                SELECT DISTINCT m.id, m.slug, m.title, m.title_ja, m.x, m.y, m.z,
                       m.cluster_id, m.genre, m.popularity, m.score, m.cover
                FROM manga m
                JOIN manga_tags t ON m.id = t.manga_id
                WHERE t.tag_name = ANY(%s)
                  AND m.popularity >= %s {genre_clause}
                ORDER BY {sort_sql}
                LIMIT %s OFFSET %s
            """, params)
        else:
            params = [popularity_min]
            if genre:
                params.append(genre)
            params += [limit, offset]
            cur.execute(f"""
                SELECT id, slug, title, title_ja, x, y, z,
                       cluster_id, genre, popularity, score, cover
                FROM manga
                WHERE popularity >= %s {genre_clause}
                ORDER BY {sort_sql}
                LIMIT %s OFFSET %s
            """, params)

        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.get("/api/manga/{manga_id}/neighbors")
def get_neighbors(manga_id: str, n: int = Query(default=12, ge=1, le=50)):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute("""
            SELECT m.id, m.slug, m.title, m.title_ja, m.x, m.y, m.z,
                   m.cluster_id, m.genre, m.popularity, m.score, m.cover,
                   nb.position
            FROM manga_neighbors nb
            JOIN manga m ON nb.neighbor_id = m.id
            WHERE nb.manga_id = %s
            ORDER BY nb.position
            LIMIT %s
        """, (real_id, n))
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.get("/api/manga/{manga_id}")
def get_manga(manga_id: str):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM manga WHERE id = %s OR slug = %s LIMIT 1",
                    (manga_id, manga_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Manga not found")
        d = dict(row)
        cur.execute("""
            SELECT tag_name AS name, rank, spoiler
            FROM manga_tags WHERE manga_id = %s ORDER BY rank DESC
        """, (d["id"],))
        d["tags"] = [dict(r) for r in cur.fetchall()]
        return d
    finally:
        put_pg(conn)


# ── タグ API ───────────────────────────────────────────────────────────────────

@app.get("/api/tags/idf")
def get_tag_idf():
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT tag_name, idf_score FROM tag_idf")
        data = {r[0]: r[1] for r in cur.fetchall()}
        return Response(
            content=_json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    finally:
        put_pg(conn)


@app.get("/api/tags")
def get_tag_list(limit: int = Query(default=500, le=2000)):
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT t.tag_name AS name, COUNT(*) AS count, i.idf_score AS idf
            FROM manga_tags t
            LEFT JOIN tag_idf i ON t.tag_name = i.tag_name
            WHERE t.spoiler = FALSE
            GROUP BY t.tag_name, i.idf_score
            ORDER BY count DESC
            LIMIT %s
        """, (limit,))
        data = [{"name": r[0], "count": r[1], "idf": r[2]} for r in cur.fetchall()]
        return Response(
            content=_json.dumps(data, ensure_ascii=False, separators=(",", ":")),
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    finally:
        put_pg(conn)


# ══════════════════════════════════════════════════════════════════════════════
# コミュニティ API
# ══════════════════════════════════════════════════════════════════════════════

# ── Reviews ───────────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/reviews")
def get_reviews(manga_id: str, authorization: Optional[str] = Header(None)):
    me = _resolve_optional_user(authorization)
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "SELECT * FROM reviews WHERE manga_id = %s ORDER BY created_at DESC",
            (real_id,)
        )
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["is_own"] = (me is not None and d.get("user_id") == me["user_id"])
            result.append(d)
        return result
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/reviews", status_code=201)
@limiter.limit("10/minute")
def create_review(request: Request, manga_id: str, review: ReviewIn, user: dict = Depends(get_current_user)):
    if not 1 <= review.rating <= 5:
        raise HTTPException(400, "Rating must be between 1 and 5")
    body = (review.body or "").strip()
    if not body:
        raise HTTPException(400, "Review body cannot be empty")
    if len(body) > 2000:
        raise HTTPException(400, "Review too long (max 2000 chars)")
    author = user["username"]
    user_id = user["user_id"]
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "INSERT INTO reviews (id, manga_id, author, rating, body, created_at, user_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (row_id, real_id, author, review.rating, body, now, user_id)
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"id": row_id, "manga_id": real_id, "author": author, "user_id": user_id,
            "rating": review.rating, "body": body, "created_at": now, "is_own": True}


@app.put("/api/manga/{manga_id}/reviews/{review_id}")
def update_review(manga_id: str, review_id: str, review: ReviewIn,
                  user: dict = Depends(get_current_user)):
    if not 1 <= review.rating <= 5:
        raise HTTPException(400, "Rating must be between 1 and 5")
    body = (review.body or "").strip()
    if not body:
        raise HTTPException(400, "Review body cannot be empty")
    if len(body) > 2000:
        raise HTTPException(400, "Review too long (max 2000 chars)")
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM reviews WHERE id = %s", (review_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Review not found")
        if row["user_id"] != user["user_id"]:
            raise HTTPException(403, "自分のレビューのみ編集できます")
        cur.execute(
            "UPDATE reviews SET rating = %s, body = %s WHERE id = %s RETURNING *",
            (review.rating, body, review_id)
        )
        updated = cur.fetchone()
        conn.commit()
        d = dict(updated)
        d["is_own"] = True
        return d
    finally:
        put_pg(conn)


@app.delete("/api/manga/{manga_id}/reviews/{review_id}", status_code=204)
def delete_review(manga_id: str, review_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM reviews WHERE id = %s", (review_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Review not found")
        if row["user_id"] != user["user_id"]:
            raise HTTPException(403, "自分のレビューのみ削除できます")
        cur.execute("DELETE FROM reviews WHERE id = %s", (review_id,))
        conn.commit()
    finally:
        put_pg(conn)


# ── Next Reads ────────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/next-reads")
def get_next_reads(manga_id: str, authorization: Optional[str] = Header(None)):
    me = _resolve_optional_user(authorization)
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute("""
            SELECT nr.id, nr.from_manga_id, nr.to_manga_id, nr.comment, nr.votes, nr.created_at,
                   nr.user_id, u.username,
                   m.slug, m.title, m.title_ja, m.cover, m.score, m.genre
            FROM next_reads nr
            JOIN manga m ON m.id = nr.to_manga_id
            LEFT JOIN users u ON nr.user_id = u.id
            WHERE nr.from_manga_id = %s
            ORDER BY nr.votes DESC, nr.created_at ASC
        """, (real_id,))
        result = []
        for r in cur.fetchall():
            d = dict(r)
            d["is_own"] = (me is not None and d.get("user_id") == me["user_id"])
            d["manga"] = {
                "id":       d["to_manga_id"],
                "slug":     d.pop("slug"),
                "title":    d.pop("title"),
                "title_ja": d.pop("title_ja"),
                "cover":    d.pop("cover"),
                "score":    d.pop("score"),
                "genre":    d.pop("genre"),
            }
            result.append(d)
        return result
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/next-reads", status_code=201)
@limiter.limit("10/minute")
def create_next_read(request: Request, manga_id: str, nr: NextReadIn, user: dict = Depends(get_current_user)):
    comment = (nr.comment or "").strip()
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_from = resolve_manga_id(cur, manga_id)
        real_to   = resolve_manga_id(cur, nr.to_manga_id)
        if real_from == real_to:
            raise HTTPException(400, "Cannot recommend a manga to itself")
        cur.execute(
            "SELECT id FROM next_reads WHERE from_manga_id = %s AND to_manga_id = %s",
            (real_from, real_to)
        )
        existing = cur.fetchone()
        if existing:
            cur.execute(
                "UPDATE next_reads SET votes = votes + 1 WHERE id = %s RETURNING *",
                (existing["id"],)
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(500, "Failed to update vote count")
            conn.commit()
            d = dict(updated)
            d["is_own"] = (d.get("user_id") == user["user_id"])
            return d
        row_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        user_id = user["user_id"]
        cur.execute(
            "INSERT INTO next_reads (id, from_manga_id, to_manga_id, comment, votes, created_at, user_id) "
            "VALUES (%s, %s, %s, %s, 1, %s, %s)",
            (row_id, real_from, real_to, comment, now, user_id)
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"id": row_id, "from_manga_id": real_from, "to_manga_id": real_to,
            "comment": comment, "votes": 1, "created_at": now,
            "user_id": user_id, "is_own": True}


@app.post("/api/next-reads/{read_id}/vote")
@limiter.limit("30/minute")
def vote_next_read(request: Request, read_id: str):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE next_reads SET votes = votes + 1 WHERE id = %s RETURNING votes",
            (read_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        conn.commit()
        return {"id": read_id, "votes": row["votes"]}
    finally:
        put_pg(conn)


@app.delete("/api/next-reads/{read_id}", status_code=204)
def delete_next_read(read_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM next_reads WHERE id = %s", (read_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        if row["user_id"] != user["user_id"]:
            raise HTTPException(403, "自分の投稿のみ削除できます")
        cur.execute("DELETE FROM next_reads WHERE id = %s", (read_id,))
        conn.commit()
    finally:
        put_pg(conn)


# ── Community Tags ─────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/community-tags")
def get_community_tags(manga_id: str):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "SELECT * FROM community_tags WHERE manga_id = %s "
            "ORDER BY (upvotes - downvotes) DESC, created_at ASC",
            (real_id,)
        )
        community = [dict(r) for r in cur.fetchall()]
        cur.execute(
            "SELECT * FROM default_tag_votes WHERE manga_id = %s",
            (real_id,)
        )
        default_votes = {
            r["tag_name"]: {"upvotes": r["upvotes"], "downvotes": r["downvotes"]}
            for r in cur.fetchall()
        }
        return {"community_tags": community, "default_tag_votes": default_votes}
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/community-tags", status_code=201)
@limiter.limit("10/minute")
def add_community_tag(request: Request, manga_id: str, body: CommunityTagIn, user: dict = Depends(get_current_user)):
    tag_name = (body.tag_name or "").strip()
    if not tag_name or len(tag_name) > 50:
        raise HTTPException(400, "タグ名は1〜50文字で入力してください")
    strength = max(20, min(100, body.strength))
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "SELECT 1 FROM manga_tags WHERE manga_id = %s AND LOWER(tag_name) = LOWER(%s)",
            (real_id, tag_name)
        )
        if cur.fetchone():
            raise HTTPException(400, "そのタグはすでにデフォルトタグとして存在します")
        cur.execute(
            "SELECT * FROM community_tags WHERE manga_id = %s AND LOWER(tag_name) = LOWER(%s)",
            (real_id, tag_name)
        )
        existing = cur.fetchone()
        if existing:
            return dict(existing)
        row_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "INSERT INTO community_tags (id, manga_id, tag_name, upvotes, downvotes, strength, created_at) "
            "VALUES (%s, %s, %s, 1, 0, %s, %s) RETURNING *",
            (row_id, real_id, tag_name, strength, now)
        )
        result = dict(cur.fetchone())
        conn.commit()
        return result
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/community-tags/{tag_name}/vote")
@limiter.limit("30/minute")
def vote_community_tag(request: Request, manga_id: str, tag_name: str, body: TagVoteIn):
    if body.delta not in (1, -1):
        raise HTTPException(400, "delta must be 1 or -1")
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        col = "upvotes" if body.delta == 1 else "downvotes"
        cur.execute(
            f"UPDATE community_tags SET {col} = {col} + 1 "
            "WHERE manga_id = %s AND tag_name = %s RETURNING *",
            (real_id, tag_name)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Community tag not found")
        conn.commit()
        return dict(row)
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/default-tags/{tag_name}/vote")
@limiter.limit("30/minute")
def vote_default_tag(request: Request, manga_id: str, tag_name: str, body: TagVoteIn):
    if body.delta not in (1, -1):
        raise HTTPException(400, "delta must be 1 or -1")
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "SELECT 1 FROM manga_tags WHERE manga_id = %s AND tag_name = %s",
            (real_id, tag_name)
        )
        if not cur.fetchone():
            raise HTTPException(404, "Tag not found on this manga")
        col = "upvotes" if body.delta == 1 else "downvotes"
        cur.execute(
            "INSERT INTO default_tag_votes (manga_id, tag_name, upvotes, downvotes) "
            "VALUES (%s, %s, 0, 0) ON CONFLICT DO NOTHING",
            (real_id, tag_name)
        )
        cur.execute(
            f"UPDATE default_tag_votes SET {col} = {col} + 1 "
            "WHERE manga_id = %s AND tag_name = %s RETURNING *",
            (real_id, tag_name)
        )
        result = dict(cur.fetchone())
        conn.commit()
        return result
    finally:
        put_pg(conn)


# ── Synopsis Translations ──────────────────────────────────────────────────────

LANGUAGE_LABELS = {
    "ja": "日本語", "en": "English", "zh": "中文", "ko": "한국어",
    "fr": "Français", "de": "Deutsch", "es": "Español", "pt": "Português",
}

@app.get("/api/manga/{manga_id}/translations")
def get_translations(manga_id: str):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "SELECT * FROM synopsis_translations WHERE manga_id = %s "
            "ORDER BY upvotes DESC, created_at ASC",
            (real_id,)
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.post("/api/manga/{manga_id}/translations", status_code=201)
@limiter.limit("10/minute")
def create_translation(request: Request, manga_id: str, body: TranslationIn, user: dict = Depends(get_current_user)):
    lang = (body.language or "ja").strip()
    if lang not in LANGUAGE_LABELS:
        raise HTTPException(400, f"Unsupported language. Use: {', '.join(LANGUAGE_LABELS)}")
    text = (body.body or "").strip()
    if not text:
        raise HTTPException(400, "翻訳本文を入力してください")
    if len(text) > 3000:
        raise HTTPException(400, "翻訳が長すぎます（最大3000文字）")
    author = user["username"]
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute(
            "INSERT INTO synopsis_translations (id, manga_id, language, body, author, upvotes, created_at) "
            "VALUES (%s, %s, %s, %s, %s, 0, %s) RETURNING *",
            (row_id, real_id, lang, text, author, now)
        )
        result = dict(cur.fetchone())
        conn.commit()
    finally:
        put_pg(conn)
    return result


@app.post("/api/translations/{translation_id}/vote")
@limiter.limit("30/minute")
def vote_translation(request: Request, translation_id: str):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "UPDATE synopsis_translations SET upvotes = upvotes + 1 "
            "WHERE id = %s RETURNING id, upvotes",
            (translation_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Translation not found")
        conn.commit()
        return dict(row)
    finally:
        put_pg(conn)


# ══════════════════════════════════════════════════════════════════════════════
# 認証 API
# ══════════════════════════════════════════════════════════════════════════════

_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_\-]{3,30}$")


@app.post("/api/auth/register", status_code=201)
@limiter.limit("5/minute")
def register(request: Request, body: AuthIn):
    if not _USERNAME_RE.match(body.username):
        raise HTTPException(400, "ユーザー名は3〜30文字の英数字・_・- のみ使えます")
    if len(body.password) < 8:
        raise HTTPException(400, "パスワードは8文字以上にしてください")
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM users WHERE username = %s", (body.username,))
        if cur.fetchone():
            raise HTTPException(409, "そのユーザー名はすでに使われています")
        user_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        cur.execute(
            "INSERT INTO users (id, username, password_hash, created_at) VALUES (%s, %s, %s, %s)",
            (user_id, body.username, _hash_password(body.password), now),
        )
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_EXPIRE_DAYS)).isoformat()
        cur.execute(
            "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
            (token, user_id, now, expires),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"token": token, "username": body.username}


@app.post("/api/auth/login")
@limiter.limit("5/minute")
def login(request: Request, body: AuthIn):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM users WHERE username = %s", (body.username,))
        row = cur.fetchone()
        if not row or not _verify_password(body.password, row["password_hash"]):
            raise HTTPException(401, "ユーザー名またはパスワードが違います")
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc).isoformat()
        expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_EXPIRE_DAYS)).isoformat()
        cur.execute(
            "INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES (%s, %s, %s, %s)",
            (token, row["id"], now, expires),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"token": token, "username": body.username}


@app.post("/api/auth/logout")
def logout(user: dict = Depends(get_current_user), authorization: Optional[str] = Header(None)):
    token = authorization[7:]
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM user_sessions WHERE token = %s", (token,))
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


# ══════════════════════════════════════════════════════════════════════════════
# ユーザーデータ API（お気に入り・閲覧済み）
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/user/favorites")
def get_favorites(user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT manga_id FROM user_favorites WHERE user_id = %s ORDER BY created_at DESC",
            (user["user_id"],),
        )
        return {"ids": [r["manga_id"] for r in cur.fetchall()]}
    finally:
        put_pg(conn)


@app.put("/api/user/favorites")
def sync_favorites(body: SyncListIn, user: dict = Depends(get_current_user)):
    """ローカルのお気に入りリストをDBと一括同期（和集合）"""
    if len(body.ids) > 5000:
        raise HTTPException(400, "ids は最大5000件までです")
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT manga_id FROM user_favorites WHERE user_id = %s", (user["user_id"],)
        )
        db_ids = {r["manga_id"] for r in cur.fetchall()}
        merged = db_ids | set(body.ids)
        now = datetime.now(timezone.utc).isoformat()
        for mid in merged:
            cur.execute(
                "INSERT INTO user_favorites (user_id, manga_id, created_at) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (user["user_id"], mid, now),
            )
        conn.commit()
        return {"ids": list(merged)}
    finally:
        put_pg(conn)


@app.post("/api/user/favorites/{manga_id}", status_code=201)
def add_favorite(manga_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_favorites (user_id, manga_id, created_at) "
            "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user["user_id"], manga_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.delete("/api/user/favorites/{manga_id}")
def remove_favorite(manga_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM user_favorites WHERE user_id = %s AND manga_id = %s",
            (user["user_id"], manga_id),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.get("/api/user/viewed")
def get_viewed(user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT manga_id FROM user_viewed WHERE user_id = %s ORDER BY created_at DESC",
            (user["user_id"],),
        )
        return {"ids": [r["manga_id"] for r in cur.fetchall()]}
    finally:
        put_pg(conn)


@app.put("/api/user/viewed")
def sync_viewed(body: SyncListIn, user: dict = Depends(get_current_user)):
    if len(body.ids) > 5000:
        raise HTTPException(400, "ids は最大5000件までです")
    conn = get_pg()
    try:
        cur = conn.cursor()
        now = datetime.now(timezone.utc).isoformat()
        for mid in body.ids:
            cur.execute(
                "INSERT INTO user_viewed (user_id, manga_id, created_at) "
                "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                (user["user_id"], mid, now),
            )
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.post("/api/user/viewed/{manga_id}", status_code=201)
def add_viewed_api(manga_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_viewed (user_id, manga_id, created_at) "
            "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
            (user["user_id"], manga_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.delete("/api/user/viewed/{manga_id}")
def remove_viewed(manga_id: str, user: dict = Depends(get_current_user)):
    conn = get_pg()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM user_viewed WHERE user_id = %s AND manga_id = %s",
            (user["user_id"], manga_id),
        )
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════
# 作品リスト API
# ══════════════════════════════════════════════════════════════════════════════

def _list_with_previews(cur, list_row: dict) -> dict:
    """リスト行に作品プレビュー画像と件数を付加する"""
    cur.execute("""
        SELECT m.cover FROM user_list_items li
        JOIN manga m ON li.manga_id = m.id
        WHERE li.list_id = %s ORDER BY li.position, li.added_at LIMIT 4
    """, (list_row["id"],))
    previews = [r["cover"] for r in cur.fetchall() if r["cover"]]
    cur.execute("SELECT COUNT(*) FROM user_list_items WHERE list_id = %s", (list_row["id"],))
    count = cur.fetchone()["count"]
    return {**list_row, "item_count": count, "preview_covers": previews}


@app.get("/api/user/lists")
def get_my_lists(user: dict = Depends(get_current_user)):
    """自分のリスト一覧（非公開含む）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM user_lists WHERE user_id = %s ORDER BY updated_at DESC",
            (user["user_id"],)
        )
        rows = [dict(r) for r in cur.fetchall()]
        return [_list_with_previews(cur, r) for r in rows]
    finally:
        put_pg(conn)


@app.post("/api/lists", status_code=201)
def create_list(body: ListCreateIn, user: dict = Depends(get_current_user)):
    """リスト作成"""
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "リスト名を入力してください")
    if len(name) > 100:
        raise HTTPException(400, "リスト名は100文字以内にしてください")
    now = datetime.now(timezone.utc).isoformat()
    list_id = str(uuid.uuid4())
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("""
            INSERT INTO user_lists(id, user_id, name, description, is_public, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *
        """, (list_id, user["user_id"], name, body.description.strip(), body.is_public, now, now))
        row = dict(cur.fetchone())
        conn.commit()
        return {**row, "item_count": 0, "preview_covers": []}
    finally:
        put_pg(conn)


@app.get("/api/lists/{list_id}")
def get_list(list_id: str, authorization: Optional[str] = Header(None)):
    """リスト詳細（非公開は本人のみ）"""
    me = _resolve_optional_user(authorization)
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM user_lists WHERE id = %s", (list_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "リストが見つかりません")
        row = dict(row)
        if not row["is_public"] and (me is None or me["user_id"] != row["user_id"]):
            raise HTTPException(403, "このリストは非公開です")
        # オーナーのユーザー名を付加
        cur.execute("SELECT username FROM users WHERE id = %s", (row["user_id"],))
        u = cur.fetchone()
        row["username"] = u["username"] if u else None
        return _list_with_previews(cur, row)
    finally:
        put_pg(conn)


@app.patch("/api/lists/{list_id}")
def update_list(list_id: str, body: ListUpdateIn, user: dict = Depends(get_current_user)):
    """リスト名・説明・公開設定変更（本人のみ）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM user_lists WHERE id = %s", (list_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "リストが見つかりません")
        if row["user_id"] != user["user_id"]:
            raise HTTPException(403, "権限がありません")
        fields, params = [], []
        if body.name is not None:
            name = body.name.strip()
            if not name: raise HTTPException(400, "リスト名を入力してください")
            fields.append("name = %s"); params.append(name)
        if body.description is not None:
            fields.append("description = %s"); params.append(body.description.strip())
        if body.is_public is not None:
            fields.append("is_public = %s"); params.append(body.is_public)
        if not fields:
            return dict(row)
        now = datetime.now(timezone.utc).isoformat()
        fields.append("updated_at = %s"); params.append(now)
        params.append(list_id)
        cur.execute(f"UPDATE user_lists SET {', '.join(fields)} WHERE id = %s RETURNING *", params)
        updated = dict(cur.fetchone())
        conn.commit()
        return _list_with_previews(cur, updated)
    finally:
        put_pg(conn)


@app.delete("/api/lists/{list_id}")
def delete_list(list_id: str, user: dict = Depends(get_current_user)):
    """リスト削除（本人のみ）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM user_lists WHERE id = %s", (list_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "リストが見つかりません")
        if row["user_id"] != user["user_id"]:
            raise HTTPException(403, "権限がありません")
        cur.execute("DELETE FROM user_lists WHERE id = %s", (list_id,))
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.get("/api/lists/{list_id}/items")
def get_list_items(list_id: str, authorization: Optional[str] = Header(None)):
    """リスト内作品一覧"""
    me = _resolve_optional_user(authorization)
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT is_public, user_id FROM user_lists WHERE id = %s", (list_id,))
        lst = cur.fetchone()
        if not lst:
            raise HTTPException(404, "リストが見つかりません")
        if not lst["is_public"] and (me is None or me["user_id"] != lst["user_id"]):
            raise HTTPException(403, "このリストは非公開です")
        cur.execute("""
            SELECT li.manga_id, li.position, li.note, li.added_at,
                   m.title, m.title_ja, m.cover, m.genre, m.score, m.popularity, m.year, m.slug
            FROM user_list_items li
            JOIN manga m ON li.manga_id = m.id
            WHERE li.list_id = %s
            ORDER BY li.position, li.added_at
        """, (list_id,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.post("/api/lists/{list_id}/items", status_code=201)
def add_to_list(list_id: str, body: ListItemIn, user: dict = Depends(get_current_user)):
    """作品をリストに追加"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM user_lists WHERE id = %s", (list_id,))
        lst = cur.fetchone()
        if not lst:
            raise HTTPException(404, "リストが見つかりません")
        if lst["user_id"] != user["user_id"]:
            raise HTTPException(403, "権限がありません")
        manga_id = resolve_manga_id(cur, body.manga_id)
        cur.execute("SELECT COUNT(*) FROM user_list_items WHERE list_id = %s", (list_id,))
        position = cur.fetchone()["count"]
        now = datetime.now(timezone.utc).isoformat()
        cur.execute("""
            INSERT INTO user_list_items(list_id, manga_id, position, note, added_at)
            VALUES (%s, %s, %s, %s, %s) ON CONFLICT(list_id, manga_id) DO NOTHING
        """, (list_id, manga_id, position, body.note.strip(), now))
        cur.execute("UPDATE user_lists SET updated_at = %s WHERE id = %s", (now, list_id))
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.delete("/api/lists/{list_id}/items/{manga_id}")
def remove_from_list(list_id: str, manga_id: str, user: dict = Depends(get_current_user)):
    """作品をリストから削除"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT user_id FROM user_lists WHERE id = %s", (list_id,))
        lst = cur.fetchone()
        if not lst:
            raise HTTPException(404, "リストが見つかりません")
        if lst["user_id"] != user["user_id"]:
            raise HTTPException(403, "権限がありません")
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute("DELETE FROM user_list_items WHERE list_id = %s AND manga_id = %s", (list_id, real_id))
        now = datetime.now(timezone.utc).isoformat()
        cur.execute("UPDATE user_lists SET updated_at = %s WHERE id = %s", (now, list_id))
        conn.commit()
    finally:
        put_pg(conn)
    return {"ok": True}


@app.get("/api/users/{username}/reviews")
def get_user_reviews(username: str):
    """ユーザーが投稿したレビュー一覧（作品情報付き）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM users WHERE username = %s", (username,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(404, "ユーザーが見つかりません")
        cur.execute("""
            SELECT r.id, r.rating, r.body, r.created_at,
                   m.id AS manga_id, m.slug, m.title, m.title_ja, m.cover, m.genre
            FROM reviews r
            JOIN manga m ON r.manga_id = m.id
            WHERE r.user_id = %s
            ORDER BY r.created_at DESC
            LIMIT 100
        """, (u["id"],))
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.get("/api/users/{username}/next-reads")
def get_user_next_reads(username: str):
    """ユーザーが投稿したおすすめ類似作品一覧（元作品・推薦先作品情報付き）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM users WHERE username = %s", (username,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(404, "ユーザーが見つかりません")
        cur.execute("""
            SELECT nr.id, nr.comment, nr.votes, nr.created_at,
                   mf.id AS from_id, mf.slug AS from_slug,
                   mf.title AS from_title, mf.title_ja AS from_title_ja, mf.cover AS from_cover,
                   mt.id AS to_id, mt.slug AS to_slug,
                   mt.title AS to_title, mt.title_ja AS to_title_ja, mt.cover AS to_cover
            FROM next_reads nr
            JOIN manga mf ON nr.from_manga_id = mf.id
            JOIN manga mt ON nr.to_manga_id   = mt.id
            WHERE nr.user_id = %s
            ORDER BY nr.created_at DESC
            LIMIT 100
        """, (u["id"],))
        return [dict(r) for r in cur.fetchall()]
    finally:
        put_pg(conn)


@app.get("/api/users/{username}/lists")
def get_user_lists(username: str):
    """他ユーザーの公開リスト一覧"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id FROM users WHERE username = %s", (username,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(404, "ユーザーが見つかりません")
        cur.execute("""
            SELECT * FROM user_lists WHERE user_id = %s AND is_public = TRUE
            ORDER BY updated_at DESC
        """, (u["id"],))
        rows = [dict(r) for r in cur.fetchall()]
        return [_list_with_previews(cur, r) for r in rows]
    finally:
        put_pg(conn)


@app.get("/api/manga/{manga_id}/lists")
def get_manga_lists(manga_id: str):
    """この作品を含む公開リスト一覧（最大20件）"""
    conn = get_pg()
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        real_id = resolve_manga_id(cur, manga_id)
        cur.execute("""
            SELECT ul.id, ul.name, ul.description, ul.updated_at, u.username
            FROM user_list_items li
            JOIN user_lists ul ON li.list_id = ul.id
            JOIN users u ON ul.user_id = u.id
            WHERE li.manga_id = %s AND ul.is_public = TRUE
            ORDER BY ul.updated_at DESC
            LIMIT 20
        """, (real_id,))
        rows = [dict(r) for r in cur.fetchall()]
        # 各リストのアイテム数を付加
        for row in rows:
            cur.execute("SELECT COUNT(*) FROM user_list_items WHERE list_id = %s", (row["id"],))
            row["item_count"] = cur.fetchone()["count"]
        return rows
    finally:
        put_pg(conn)


# ── 静的ファイル配信（本番用） ─────────────────────────────────────────────────
def _index_html() -> Path:
    return DIST_DIR / "index.html"


def _static_response(file_path: Path) -> FileResponse:
    """静的ファイルに適切な Cache-Control を付与して返す"""
    name = file_path.name
    suffix = file_path.suffix.lower()
    headers: dict[str, str] = {}

    # Vite がハッシュ付きファイル名を生成する (例: index-CVvh-Kki.js)
    # assets/ 配下のファイルはすべてハッシュ付き → 長期キャッシュ
    if "assets" in file_path.parts:
        headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif suffix == ".json":
        # データ JSON (manga_map_light.json 等) → 1日キャッシュ
        headers["Cache-Control"] = "public, max-age=86400"
    elif suffix == ".html":
        # HTML は常に再検証
        headers["Cache-Control"] = "no-cache"
    else:
        headers["Cache-Control"] = "public, max-age=3600"

    return FileResponse(file_path, headers=headers)


if DIST_DIR.exists():
    @app.get("/manga/{manga_id}", include_in_schema=False)
    def serve_manga_detail(manga_id: str):
        prerendered = DIST_DIR / "manga" / manga_id / "index.html"
        if prerendered.exists():
            return FileResponse(prerendered, media_type="text/html",
                                headers={"Cache-Control": "no-cache"})
        return FileResponse(_index_html(), media_type="text/html",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/user/{username}", include_in_schema=False)
    def serve_user_page(username: str):
        return FileResponse(_index_html(), media_type="text/html",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/list/{list_id}", include_in_schema=False)
    def serve_list_page(list_id: str):
        return FileResponse(_index_html(), media_type="text/html",
                            headers={"Cache-Control": "no-cache"})

    @app.get("/sitemap.xml", include_in_schema=False)
    def serve_sitemap():
        """マンガ全ページ + 公開リスト + ユーザーページを含む動的サイトマップ"""
        conn = get_pg()
        try:
            cur = conn.cursor()
            # マンガ slugs
            cur.execute("SELECT slug FROM manga WHERE slug IS NOT NULL ORDER BY id")
            slugs = [r[0] for r in cur.fetchall()]
            # 公開リスト
            cur.execute("SELECT id FROM lists WHERE is_public = TRUE ORDER BY created_at DESC LIMIT 500")
            list_ids = [r[0] for r in cur.fetchall()]
            # レビュー等の活動があるユーザー
            cur.execute("""
                SELECT DISTINCT u.username FROM users u
                WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.user_id = u.id)
                   OR EXISTS (SELECT 1 FROM lists l WHERE l.user_id = u.id AND l.is_public = TRUE)
                ORDER BY u.username LIMIT 500
            """)
            usernames = [r[0] for r in cur.fetchall()]
        finally:
            put_pg(conn)

        urls = []
        urls.append(f'  <url><loc>{SITE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>')
        urls.append(f'  <url><loc>{SITE_URL}/manga</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>')
        urls.append(f'  <url><loc>{SITE_URL}/manga/map</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>')
        for slug in slugs:
            urls.append(f'  <url><loc>{SITE_URL}/manga/{slug}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>')
        for uid in list_ids:
            urls.append(f'  <url><loc>{SITE_URL}/list/{uid}</loc><changefreq>weekly</changefreq><priority>0.4</priority></url>')
        for uname in usernames:
            urls.append(f'  <url><loc>{SITE_URL}/user/{uname}</loc><changefreq>weekly</changefreq><priority>0.4</priority></url>')

        xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        xml += '\n'.join(urls)
        xml += '\n</urlset>\n'
        return Response(content=xml, media_type="application/xml")

    @app.get("/robots.txt", include_in_schema=False)
    def serve_robots():
        body = f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n"
        return Response(content=body, media_type="text/plain")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        static_file = (DIST_DIR / full_path).resolve()
        # パストラバーサル防止: DIST_DIR 配下のみ許可
        if static_file.is_file() and str(static_file).startswith(str(DIST_DIR.resolve())):
            return _static_response(static_file)
        return FileResponse(_index_html(), media_type="text/html",
                            headers={"Cache-Control": "no-cache"})
