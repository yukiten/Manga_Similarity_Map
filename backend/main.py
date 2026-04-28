"""
Manga Map FastAPI Backend
=========================
Optional: the frontend can run standalone using public/manga_map.json.
This server adds search and neighbor API endpoints.

Usage:
    pip install fastapi uvicorn
    uvicorn backend.main:app --reload --port 8000
"""

import json
import math
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

app = FastAPI(title="Manga Map API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_FILE = Path(__file__).parent / "output" / "manga_map.json"
FALLBACK  = Path(__file__).parent.parent / "frontend" / "public" / "manga_map.json"
DB_FILE   = Path(__file__).parent / "data" / "community.db"
DIST_DIR  = Path(__file__).parent.parent / "frontend" / "dist"

def load_data():
    path = DATA_FILE if DATA_FILE.exists() else FALLBACK
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

@app.on_event("startup")
def init_db():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY,
            manga_id TEXT NOT NULL,
            author TEXT NOT NULL DEFAULT 'Anonymous',
            rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
            body TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS community_tags (
            id TEXT PRIMARY KEY,
            manga_id TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            upvotes INTEGER NOT NULL DEFAULT 1,
            downvotes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            UNIQUE(manga_id, tag_name)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS default_tag_votes (
            manga_id TEXT NOT NULL,
            tag_name TEXT NOT NULL,
            upvotes INTEGER NOT NULL DEFAULT 0,
            downvotes INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(manga_id, tag_name)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS next_reads (
            id TEXT PRIMARY KEY,
            from_manga_id TEXT NOT NULL,
            to_manga_id TEXT NOT NULL,
            comment TEXT NOT NULL DEFAULT '',
            votes INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            UNIQUE(from_manga_id, to_manga_id)
        )
    """)
    conn.commit()
    conn.close()

class CommunityTagIn(BaseModel):
    tag_name: str

class TagVoteIn(BaseModel):
    delta: int  # +1 or -1

class ReviewIn(BaseModel):
    author: str = "Anonymous"
    rating: int
    body: str

class NextReadIn(BaseModel):
    to_manga_id: str
    comment: str = ""

def euclidean(a, b):
    return math.sqrt((a["x"]-b["x"])**2 + (a["y"]-b["y"])**2 + (a["z"]-b["z"])**2)

@app.get("/api/manga")
def list_manga():
    return load_data()

@app.get("/api/manga/{manga_id}")
def get_manga(manga_id: str):
    data = load_data()
    item = next((m for m in data if m["id"] == manga_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Manga not found")
    return item

@app.get("/api/manga/{manga_id}/neighbors")
def get_neighbors(manga_id: str, n: int = Query(default=5, ge=1, le=20)):
    data = load_data()
    item = next((m for m in data if m["id"] == manga_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Manga not found")
    others = [{"distance": euclidean(item, m), **m} for m in data if m["id"] != manga_id]
    others.sort(key=lambda x: x["distance"])
    return others[:n]

@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    data = load_data()
    lower = q.lower()
    results = [
        m for m in data
        if lower in m["title"].lower() or any(lower in t for t in m.get("tags", []))
    ]
    return results[:20]


# ── Reviews ──────────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/reviews")
def get_reviews(manga_id: str):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM reviews WHERE manga_id = ? ORDER BY created_at DESC",
        (manga_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/manga/{manga_id}/reviews", status_code=201)
def create_review(manga_id: str, review: ReviewIn):
    if not 1 <= review.rating <= 5:
        raise HTTPException(400, "Rating must be between 1 and 5")
    body = (review.body or "").strip()
    if not body:
        raise HTTPException(400, "Review body cannot be empty")
    if len(body) > 2000:
        raise HTTPException(400, "Review too long (max 2000 chars)")
    author = (review.author or "Anonymous").strip() or "Anonymous"
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    conn.execute(
        "INSERT INTO reviews (id, manga_id, author, rating, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (row_id, manga_id, author, review.rating, body, now)
    )
    conn.commit()
    conn.close()
    return {"id": row_id, "manga_id": manga_id, "author": author,
            "rating": review.rating, "body": body, "created_at": now}


# ── Next Reads ────────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/next-reads")
def get_next_reads(manga_id: str):
    data = load_data()
    manga_by_id = {m["id"]: m for m in data}
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM next_reads WHERE from_manga_id = ? ORDER BY votes DESC, created_at ASC",
        (manga_id,)
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        m = manga_by_id.get(d["to_manga_id"])
        if m:
            d["manga"] = {
                "id": m["id"], "title": m["title"],
                "title_ja": m.get("title_ja"),
                "cover_url": m.get("cover_url"),
                "score": m.get("score"),
                "genre": m.get("genre"),
                "tags": m.get("tags", [])[:3],
            }
        result.append(d)
    return result

@app.post("/api/manga/{manga_id}/next-reads", status_code=201)
def create_next_read(manga_id: str, nr: NextReadIn):
    data = load_data()
    if not any(m["id"] == nr.to_manga_id for m in data):
        raise HTTPException(404, "Target manga not found")
    if manga_id == nr.to_manga_id:
        raise HTTPException(400, "Cannot recommend a manga to itself")
    comment = (nr.comment or "").strip()
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM next_reads WHERE from_manga_id = ? AND to_manga_id = ?",
        (manga_id, nr.to_manga_id)
    ).fetchone()
    if existing:
        conn.execute("UPDATE next_reads SET votes = votes + 1 WHERE id = ?", (existing["id"],))
        conn.commit()
        row = conn.execute("SELECT * FROM next_reads WHERE id = ?", (existing["id"],)).fetchone()
        conn.close()
        return dict(row)
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        "INSERT INTO next_reads (id, from_manga_id, to_manga_id, comment, votes, created_at) "
        "VALUES (?, ?, ?, ?, 1, ?)",
        (row_id, manga_id, nr.to_manga_id, comment, now)
    )
    conn.commit()
    conn.close()
    return {"id": row_id, "from_manga_id": manga_id, "to_manga_id": nr.to_manga_id,
            "comment": comment, "votes": 1, "created_at": now}

@app.post("/api/next-reads/{read_id}/vote")
def vote_next_read(read_id: str):
    conn = get_db()
    row = conn.execute("SELECT id FROM next_reads WHERE id = ?", (read_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Not found")
    conn.execute("UPDATE next_reads SET votes = votes + 1 WHERE id = ?", (read_id,))
    conn.commit()
    updated = conn.execute("SELECT votes FROM next_reads WHERE id = ?", (read_id,)).fetchone()
    conn.close()
    return {"id": read_id, "votes": updated["votes"]}


# ── Community Tags ─────────────────────────────────────────────────────────────

@app.get("/api/manga/{manga_id}/community-tags")
def get_community_tags(manga_id: str):
    conn = get_db()
    community = conn.execute(
        "SELECT * FROM community_tags WHERE manga_id = ? ORDER BY (upvotes - downvotes) DESC, created_at ASC",
        (manga_id,)
    ).fetchall()
    default_votes = conn.execute(
        "SELECT * FROM default_tag_votes WHERE manga_id = ?",
        (manga_id,)
    ).fetchall()
    conn.close()
    return {
        "community_tags": [dict(r) for r in community],
        "default_tag_votes": {
            r["tag_name"]: {"upvotes": r["upvotes"], "downvotes": r["downvotes"]}
            for r in default_votes
        },
    }

@app.post("/api/manga/{manga_id}/community-tags", status_code=201)
def add_community_tag(manga_id: str, body: CommunityTagIn):
    tag_name = (body.tag_name or "").strip()
    if not tag_name or len(tag_name) > 50:
        raise HTTPException(400, "タグ名は1〜50文字で入力してください")
    data = load_data()
    manga = next((m for m in data if m["id"] == manga_id), None)
    if not manga:
        raise HTTPException(404, "Manga not found")
    if any(t["name"].lower() == tag_name.lower() for t in manga.get("tags", [])):
        raise HTTPException(400, "そのタグはすでにデフォルトタグとして存在します")
    row_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM community_tags WHERE manga_id = ? AND LOWER(tag_name) = LOWER(?)",
        (manga_id, tag_name)
    ).fetchone()
    if existing:
        conn.close()
        return dict(existing)
    conn.execute(
        "INSERT INTO community_tags (id, manga_id, tag_name, upvotes, downvotes, created_at) VALUES (?, ?, ?, 1, 0, ?)",
        (row_id, manga_id, tag_name, now)
    )
    conn.commit()
    result = conn.execute("SELECT * FROM community_tags WHERE id = ?", (row_id,)).fetchone()
    conn.close()
    return dict(result)

@app.post("/api/manga/{manga_id}/community-tags/{tag_name}/vote")
def vote_community_tag(manga_id: str, tag_name: str, body: TagVoteIn):
    if body.delta not in (1, -1):
        raise HTTPException(400, "delta must be 1 or -1")
    conn = get_db()
    row = conn.execute(
        "SELECT id FROM community_tags WHERE manga_id = ? AND tag_name = ?",
        (manga_id, tag_name)
    ).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Community tag not found")
    if body.delta == 1:
        conn.execute("UPDATE community_tags SET upvotes = upvotes + 1 WHERE id = ?", (row["id"],))
    else:
        conn.execute("UPDATE community_tags SET downvotes = downvotes + 1 WHERE id = ?", (row["id"],))
    conn.commit()
    result = conn.execute("SELECT * FROM community_tags WHERE id = ?", (row["id"],)).fetchone()
    conn.close()
    return dict(result)

@app.post("/api/manga/{manga_id}/default-tags/{tag_name}/vote")
def vote_default_tag(manga_id: str, tag_name: str, body: TagVoteIn):
    if body.delta not in (1, -1):
        raise HTTPException(400, "delta must be 1 or -1")
    data = load_data()
    manga = next((m for m in data if m["id"] == manga_id), None)
    if not manga:
        raise HTTPException(404, "Manga not found")
    if not any(t["name"] == tag_name for t in manga.get("tags", [])):
        raise HTTPException(404, "Tag not found on this manga")
    conn = get_db()
    existing = conn.execute(
        "SELECT * FROM default_tag_votes WHERE manga_id = ? AND tag_name = ?",
        (manga_id, tag_name)
    ).fetchone()
    if not existing:
        conn.execute(
            "INSERT INTO default_tag_votes (manga_id, tag_name, upvotes, downvotes) VALUES (?, ?, 0, 0)",
            (manga_id, tag_name)
        )
    if body.delta == 1:
        conn.execute(
            "UPDATE default_tag_votes SET upvotes = upvotes + 1 WHERE manga_id = ? AND tag_name = ?",
            (manga_id, tag_name)
        )
    else:
        conn.execute(
            "UPDATE default_tag_votes SET downvotes = downvotes + 1 WHERE manga_id = ? AND tag_name = ?",
            (manga_id, tag_name)
        )
    conn.commit()
    result = conn.execute(
        "SELECT * FROM default_tag_votes WHERE manga_id = ? AND tag_name = ?",
        (manga_id, tag_name)
    ).fetchone()
    conn.close()
    return dict(result)


# ── 静的ファイル配信（本番用） ─────────────────────────────────────────────────
# `npm run build:seo` で生成した dist/ を FastAPI から配信する。
# プリレンダー済み HTML が存在する場合はそれを返し、
# 存在しない場合は SPA フォールバックとして index.html を返す。

def _index_html() -> Path:
    return DIST_DIR / "index.html"

if DIST_DIR.exists():
    # /manga/:id — プリレンダー済み HTML を優先、なければ SPA フォールバック
    @app.get("/manga/{manga_id}", include_in_schema=False)
    def serve_manga_detail(manga_id: str):
        prerendered = DIST_DIR / "manga" / manga_id / "index.html"
        if prerendered.exists():
            return FileResponse(prerendered, media_type="text/html")
        return FileResponse(_index_html(), media_type="text/html")

    # sitemap.xml
    @app.get("/sitemap.xml", include_in_schema=False)
    def serve_sitemap():
        sitemap = DIST_DIR / "sitemap.xml"
        if sitemap.exists():
            return FileResponse(sitemap, media_type="application/xml")
        raise HTTPException(404, "sitemap.xml not found")

    # SPA フォールバック（/manga, /anime, / など）
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        static_file = DIST_DIR / full_path
        if static_file.is_file():
            return FileResponse(static_file)
        return FileResponse(_index_html(), media_type="text/html")
