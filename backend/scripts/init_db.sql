-- pgvector拡張（類似検索用）
CREATE EXTENSION IF NOT EXISTS vector;

-- ── マンガカタログ ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manga (
    id              TEXT PRIMARY KEY,
    slug            TEXT UNIQUE,
    title           TEXT NOT NULL,
    title_ja        TEXT,
    title_romaji    TEXT,
    x               REAL,
    y               REAL,
    z               REAL,
    cluster_id      INTEGER,
    genre           TEXT,
    synopsis        TEXT,
    synopsis_ja     TEXT,
    popularity      INTEGER DEFAULT 1,
    score           REAL,
    year            INTEGER,
    cover           TEXT,
    url             TEXT,
    -- 楽天データ
    image_url       TEXT,
    affiliate_url   TEXT,
    isbn            TEXT,
    author          TEXT,
    publisher       TEXT,
    sales_date      TEXT,
    review_average  TEXT,
    review_count    INTEGER DEFAULT 0
);

-- ── タグ（絞り込み・類似検索用） ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manga_tags (
    manga_id    TEXT NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
    tag_name    TEXT NOT NULL,
    rank        INTEGER NOT NULL DEFAULT 0,
    spoiler     BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (manga_id, tag_name)
);

-- ── 近傍リスト（事前計算済み） ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manga_neighbors (
    manga_id    TEXT NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
    neighbor_id TEXT NOT NULL REFERENCES manga(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,  -- 1始まりの近さ順
    PRIMARY KEY (manga_id, neighbor_id)
);

-- ── タグIDF（類似検索の重み） ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tag_idf (
    tag_name    TEXT PRIMARY KEY,
    idf_score   REAL NOT NULL,
    doc_count   INTEGER NOT NULL DEFAULT 0
);

-- ── コミュニティ機能 ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    manga_id    TEXT NOT NULL,
    author      TEXT NOT NULL DEFAULT 'Anonymous',
    rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    CONSTRAINT fk_reviews_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS community_tags (
    id          TEXT PRIMARY KEY,
    manga_id    TEXT NOT NULL,
    tag_name    TEXT NOT NULL,
    upvotes     INTEGER NOT NULL DEFAULT 1,
    downvotes   INTEGER NOT NULL DEFAULT 0,
    strength    INTEGER NOT NULL DEFAULT 50,
    created_at  TEXT NOT NULL,
    UNIQUE (manga_id, tag_name),
    CONSTRAINT fk_community_tags_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS default_tag_votes (
    manga_id    TEXT NOT NULL,
    tag_name    TEXT NOT NULL,
    upvotes     INTEGER NOT NULL DEFAULT 0,
    downvotes   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (manga_id, tag_name),
    CONSTRAINT fk_default_tag_votes_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS next_reads (
    id              TEXT PRIMARY KEY,
    from_manga_id   TEXT NOT NULL,
    to_manga_id     TEXT NOT NULL,
    comment         TEXT NOT NULL DEFAULT '',
    votes           INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    UNIQUE (from_manga_id, to_manga_id),
    CONSTRAINT fk_next_reads_from FOREIGN KEY (from_manga_id) REFERENCES manga(id) ON DELETE CASCADE,
    CONSTRAINT fk_next_reads_to   FOREIGN KEY (to_manga_id)   REFERENCES manga(id) ON DELETE CASCADE
);

-- ── 認証・ユーザーデータ ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    CONSTRAINT fk_user_sessions_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_favorites (
    user_id    TEXT NOT NULL,
    manga_id   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, manga_id),
    CONSTRAINT fk_user_favorites_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_favorites_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_viewed (
    user_id    TEXT NOT NULL,
    manga_id   TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_id, manga_id),
    CONSTRAINT fk_user_viewed_users FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_viewed_manga FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

-- ── インデックス ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_manga_genre      ON manga (genre);
CREATE INDEX IF NOT EXISTS idx_manga_popularity ON manga (popularity);
CREATE INDEX IF NOT EXISTS idx_manga_score      ON manga (score DESC);
CREATE INDEX IF NOT EXISTS idx_manga_slug       ON manga (slug);
CREATE INDEX IF NOT EXISTS idx_manga_tags_name  ON manga_tags (tag_name);
CREATE INDEX IF NOT EXISTS idx_manga_neighbors  ON manga_neighbors (manga_id, position);
CREATE INDEX IF NOT EXISTS idx_reviews_manga    ON reviews (manga_id);
CREATE INDEX IF NOT EXISTS idx_ctags_manga      ON community_tags (manga_id);
CREATE INDEX IF NOT EXISTS idx_next_reads_from  ON next_reads (from_manga_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions    ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_favorites   ON user_favorites (user_id);
CREATE INDEX IF NOT EXISTS idx_user_viewed      ON user_viewed (user_id);
