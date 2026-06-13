# Ruima - Manga Similarity Map

漫画作品をタグ・ジャンル情報から類似度を算出し、3D/2D マップ上にプロットするWebアプリケーション。

## 概要

各作品のタグを TF-IDF で重み付けしたベクトルに変換し、UMAP で 3 次元に圧縮してマップ上に配置する。似た作品が近くに表示されるため、視覚的に作品を探索できる。

### 主な機能

- **3D / 2D マップ表示** — Three.js による WebGL 散布図で全作品を俯瞰
- **類似作品ツリーマップ** — 選択した作品に近い作品をツリーマップで表示
- **タグ・ジャンルフィルタ** — タグ選択で表示作品を絞り込み
- **あいまい検索** — タイトル・作者名でリアルタイム検索
- **ユーザー機能** — アカウント登録、お気に入り、読書リスト管理
- **コミュニティ機能** — レビュー、コミュニティタグ、「次に読む」提案

## 技術スタック

### フロントエンド

- React 18 + Vite 5
- React Router v7
- Three.js / @react-three/fiber（3D レンダリング）
- react-spring（アニメーション）

### バックエンド

- FastAPI + Uvicorn
- PostgreSQL + pgvector
- slowapi（レートリミット）
- brotli-asgi（圧縮）

### データパイプライン

- sentence-transformers（埋め込みベクトル生成）
- umap-learn（次元圧縮）
- scikit-learn / KMeans（クラスタリング）

## ディレクトリ構成

```
├── backend/
│   ├── main.py                  # FastAPI アプリケーション
│   ├── requirements.txt
│   └── scripts/
│       ├── sync_anilist.py      # AniList からデータ取得
│       ├── fetch_openbd.py      # OpenBD から書誌情報取得
│       ├── fetch_rakuten.py     # 楽天ブックスから情報取得
│       ├── generate_embeddings.py  # ベクトル生成 → UMAP → クラスタリング
│       ├── build_light_json.py  # フロント用軽量 JSON 生成
│       ├── run_sync.py          # パイプライン一括実行
│       └── init_db.sql          # DB スキーマ定義
├── frontend/
│   ├── src/
│   │   ├── MapApp.jsx           # メインマップ画面
│   │   ├── components/          # UI コンポーネント群
│   │   ├── pages/               # ユーザー・リストページ
│   │   └── lib/                 # API クライアント・ユーティリティ
│   ├── scripts/prerender.js     # SEO 用プリレンダリング
│   └── vite.config.js
└── .env.example
```

## セットアップ

### 前提条件

- Node.js 18+
- Python 3.11+
- PostgreSQL 15+（pgvector 拡張が必要）

### 1. 環境変数

```bash
cp .env.example .env
# DATABASE_URL, CORS_ORIGINS, SITE_URL を設定
```

### 2. データベース初期化

```bash
psql -U postgres -d mangamap -f backend/scripts/init_db.sql
```

### 3. データパイプライン実行

```bash
pip install -r backend/requirements.txt
python backend/scripts/run_sync.py
```

### 4. バックエンド起動

```bash
uvicorn backend.main:app --reload --port 8000
```

### 5. フロントエンド起動

```bash
cd frontend
npm install
npm run dev
```

開発サーバーが `http://localhost:5173` で起動し、API リクエストはバックエンドにプロキシされる。

### 本番ビルド

```bash
cd frontend
npm run build:seo   # Vite ビルド + SSR プリレンダリング
```

## ライセンス

MIT
