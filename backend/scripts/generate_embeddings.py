"""
Manga Embedding Generator
=========================
タグベクトル（rank × IDF）→ UMAP 3D + KMeans クラスタリング

出力:
  frontend/public/manga_map.json   - 作品データ（cluster_id・neighbors 付き）
  frontend/public/cluster_map.json - クラスタメタ情報
  frontend/public/tag_idf.json
  frontend/public/tag_list.json

Usage:
    pip install umap-learn numpy scipy scikit-learn
    python backend/scripts/generate_embeddings.py
"""

import json
import math
import sys
import shutil
from pathlib import Path
from collections import Counter

SCRIPT_DIR  = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent
MERGED_FILE  = BACKEND_DIR / "data" / "merged.json"
ANILIST_FILE = BACKEND_DIR / "data" / "anilist_raw.json"
DATA_FILE    = BACKEND_DIR / "data" / "manga_data.json"
OUTPUT_DIR  = BACKEND_DIR / "output"
OUTPUT_FILE = OUTPUT_DIR / "manga_map.json"
FRONTEND_PUBLIC = BACKEND_DIR.parent / "frontend" / "public" / "manga_map.json"
MODEL_DIR   = BACKEND_DIR / "data" / "model"   # 差分同期用モデルアーティファクト

# データ件数に応じて動的に決定（main() 内で上書き）
N_NEIGHBORS  = 15   # kNN の近傍数（フォールバック値）
N_CLUSTERS   = 40   # クラスタ数（フォールバック値）

def calc_n_neighbors(n: int) -> int:
    """
    件数に応じた n_neighbors を返す。
    大きいほど大域的構造が保存され「タグ的に近い = 3D で近い」になりやすい。
    小さいとジャンル軸だけが残り細かい類似が失われる。
      n <  1,000 → 30
      n <  5,000 → 50
      n < 10,000 → 60
      n < 20,000 → 80
      n >= 20,000 → 100  (実用上の上限; 計算コスト増に注意)
    """
    if n <  1_000:  return 30
    if n <  5_000:  return 50
    if n < 10_000:  return 60
    if n < 20_000:  return 80
    return 100

def calc_n_clusters(n: int) -> int:
    """
    件数に応じたクラスタ数。目安: 1クラスタあたり 400〜600 件。
    """
    return min(200, max(40, n // 500))

# ── データ読み込み ────────────────────────────────────────────────────────────

def load_manga():
    for path in [MERGED_FILE, ANILIST_FILE, DATA_FILE]:
        if path.exists():
            print(f"  読み込み: {path}")
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError("データファイルが見つかりません")

# ── IDF 計算 ─────────────────────────────────────────────────────────────────

def compute_tag_idf(manga_list):
    N, df = len(manga_list), {}
    for manga in manga_list:
        seen = set()
        for tag in manga.get("tags", []):
            if isinstance(tag, dict):
                name = tag["name"]
                if name not in seen:
                    df[name] = df.get(name, 0) + 1
                    seen.add(name)
    idf = {name: round(math.log(N / count), 4) for name, count in df.items()}
    tag_list = sorted(
        [{"name": n, "count": df[n], "idf": idf[n]} for n in df],
        key=lambda x: x["count"], reverse=True,
    )
    return idf, tag_list

# ── タグ疎行列 ────────────────────────────────────────────────────────────────

def build_tag_matrix(manga_list, idf):
    import numpy as np
    import scipy.sparse as sp

    vocab      = sorted(idf.keys())
    tag_to_idx = {t: i for i, t in enumerate(vocab)}
    V, N       = len(vocab), len(manga_list)
    rows, cols, data = [], [], []

    for i, manga in enumerate(manga_list):
        for tag in manga.get("tags", []):
            if not isinstance(tag, dict) or tag.get("spoiler", False):
                continue
            name = tag.get("name", "")
            if name not in tag_to_idx:
                continue
            w = (tag.get("rank", 0) / 100.0) * idf[name]
            if w > 0:
                rows.append(i); cols.append(tag_to_idx[name]); data.append(w)

    mat = sp.csr_matrix((data, (rows, cols)), shape=(N, V), dtype=np.float32)
    print(f"  タグ行列: {N} × {V}  非ゼロ={mat.nnz}")
    return mat

# ── kNN 計算 ─────────────────────────────────────────────────────────────────

def compute_knn(mat, n_neighbors):
    try:
        from umap.umap_ import nearest_neighbors as _umap_nn
        import numpy as np
        print(f"  NN-Descent kNN (n={n_neighbors}) …")
        knn_idx, knn_dist, _ = _umap_nn(
            mat, n_neighbors=n_neighbors,
            metric="cosine", metric_kwds={}, angular=True,
            random_state=np.random.RandomState(42), verbose=False,
        )
        print(f"  ✓ kNN: {knn_idx.shape}")
        return knn_idx, knn_dist
    except Exception as e:
        print(f"  ⚠ kNN 失敗 ({e}) → None")
        return None, None

# ── UMAP 3D ──────────────────────────────────────────────────────────────────

def run_umap(mat, knn_idx, knn_dist, n_neighbors):
    import umap
    import numpy as np

    n_samples = mat.shape[0]
    # 大規模データでは low_memory=True と n_epochs 削減で現実的な時間に収める
    low_memory = n_samples >= 10_000
    n_epochs   = 200 if n_samples >= 20_000 else None  # None = UMAP デフォルト

    kwargs = dict(
        n_components=3,
        n_neighbors=n_neighbors,
        min_dist=0.05,
        metric="cosine",
        random_state=42,
        low_memory=low_memory,
        n_epochs=n_epochs,
    )
    if low_memory:
        print(f"  large-dataset モード: low_memory=True, n_epochs={n_epochs}")

    reducer = None
    if knn_idx is not None:
        try:
            reducer = umap.UMAP(**kwargs, precomputed_knn=(knn_idx, knn_dist))
            print("  precomputed_knn 使用")
        except TypeError:
            pass
    if reducer is None:
        reducer = umap.UMAP(**kwargs)

    print("  UMAP 3D 計算中 …")
    raw_coords = reducer.fit_transform(mat)

    # 正規化パラメータを保存（差分同期で新規点に同じスケールを適用するため）
    norm_params = []
    for axis in range(3):
        col  = raw_coords[:, axis]
        vmin = float(col.min())
        vmax = float(col.max())
        norm_params.append({"min": vmin, "max": vmax, "range": float(vmax - vmin)})

    coords = raw_coords.copy()
    for axis in range(3):
        p = norm_params[axis]
        if p["range"] > 0:
            coords[:, axis] = (raw_coords[:, axis] - p["min"]) / p["range"] * 10 - 5

    return coords, reducer, norm_params

# ── クラスタリング ────────────────────────────────────────────────────────────

def cluster_coords(coords, n_clusters):
    from sklearn.cluster import KMeans
    print(f"  KMeans クラスタリング (n={n_clusters}) …")
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto")
    labels = km.fit_predict(coords)
    print(f"  ✓ {n_clusters} クラスタ")
    return labels

GENRE_COLOR = {
    "action": "#ef4444", "adventure": "#f97316", "romance": "#ec4899",
    "mystery": "#8b5cf6", "sci-fi": "#06b6d4", "fantasy": "#3b82f6",
    "horror": "#f43f5e", "comedy": "#eab308", "drama": "#f59e0b",
    "sports": "#22c55e", "psychological": "#a855f7", "supernatural": "#6366f1",
    "slice-of-life": "#14b8a6", "historical": "#d97706", "mecha": "#64748b",
    "thriller": "#9f1239",
}

def build_cluster_info(manga_list, coords, labels, tag_idf):
    import numpy as np

    buckets = {}
    for manga, xyz, lbl in zip(manga_list, coords, labels):
        lbl = int(lbl)
        if lbl not in buckets:
            buckets[lbl] = {"mangas": [], "xyzs": []}
        buckets[lbl]["mangas"].append(manga)
        buckets[lbl]["xyzs"].append(xyz)

    clusters = []
    for cid, bucket in sorted(buckets.items()):
        mangas   = bucket["mangas"]
        centroid = np.array(bucket["xyzs"]).mean(axis=0)

        # 代表タグ（クラスタ内スコア上位）
        tag_score = Counter()
        for manga in mangas:
            for tag in manga.get("tags", []):
                if not isinstance(tag, dict) or tag.get("spoiler", False):
                    continue
                name = tag["name"]
                rank = tag.get("rank", 0)
                tag_score[name] += (rank / 100.0) * tag_idf.get(name, 1.0)
        top_tags = [t for t, _ in tag_score.most_common(6)]

        # 支配的ジャンル・色
        dominant = Counter(m.get("genre", "unknown") for m in mangas).most_common(1)[0][0]
        color    = GENRE_COLOR.get(dominant, "#6b7280")

        clusters.append({
            "id":       cid,
            "label":    " · ".join(top_tags[:3]) if top_tags else f"Cluster {cid}",
            "top_tags": top_tags,
            "count":    len(mangas),
            "centroid": {
                "x": round(float(centroid[0]), 4),
                "y": round(float(centroid[1]), 4),
                "z": round(float(centroid[2]), 4),
            },
            "color": color,
        })

    return clusters

# ── 出力構築 ─────────────────────────────────────────────────────────────────

def build_output(manga_list, coords, labels):
    from sklearn.neighbors import NearestNeighbors
    import numpy as np

    # UMAP 後の 3D 座標で kNN を計算 → 「視覚的に近い = Similar Works」を保証
    k = min(13, len(manga_list))   # 自分自身 + 12件
    knn_3d = NearestNeighbors(n_neighbors=k, metric='euclidean', algorithm='auto', n_jobs=-1)
    knn_3d.fit(coords)
    _, indices = knn_3d.kneighbors(coords)
    print(f"  ✓ 3D kNN 計算完了 (k={k-1})")

    result = []
    for i, (manga, xyz) in enumerate(zip(manga_list, coords)):
        # indices[i][0] は自分自身なのでスキップ
        neighbor_ids = [
            manga_list[int(j)]["id"]
            for j in indices[i][1:]
            if int(j) < len(manga_list) and manga_list[int(j)]["id"] != manga["id"]
        ]
        result.append({
            "id":           manga["id"],
            "title":        manga["title"],
            "title_ja":     manga.get("title_ja", ""),
            "title_romaji": manga.get("title_romaji", ""),
            "x":          round(float(xyz[0]), 4),
            "y":          round(float(xyz[1]), 4),
            "z":          round(float(xyz[2]), 4),
            "cluster_id": int(labels[i]),
            "tags":       manga.get("tags", []),
            "genre":      manga.get("genre") or (manga.get("genres", [""])[0].lower() if manga.get("genres") else "unknown"),
            "synopsis":   manga.get("synopsis", ""),
            "popularity": manga.get("popularity", 3),
            "score":      manga.get("score"),
            "year":       manga.get("year"),
            "cover":      manga.get("cover", ""),
            "url":        manga.get("url", ""),
            "neighbors":  neighbor_ids,
        })
    return result

# ── メイン ───────────────────────────────────────────────────────────────────

def main():
    manga_list = load_manga()
    N = len(manga_list)
    print(f"  {N} 件")

    try:
        import umap, numpy as np, scipy.sparse
        from sklearn.cluster import KMeans
    except ImportError as e:
        print(f"⚠  依存不足: {e}\n   pip install umap-learn numpy scipy scikit-learn")
        sys.exit(1)

    # 件数に応じてパラメータを決定
    n_neighbors = calc_n_neighbors(N)
    n_clusters  = calc_n_clusters(N)
    print(f"  n_neighbors={n_neighbors}, n_clusters={n_clusters}")

    print("\n[1/5] IDF 計算 …")
    tag_idf, tag_list = compute_tag_idf(manga_list)
    print(f"  タグ種類: {len(tag_idf)}")

    print("\n[2/5] タグ行列構築 …")
    mat = build_tag_matrix(manga_list, tag_idf)

    print("\n[3/5] kNN 計算 …")
    knn_idx, knn_dist = compute_knn(mat, n_neighbors)

    print("\n[4/5] UMAP 3D …")
    coords, reducer, norm_params = run_umap(mat, knn_idx, knn_dist, n_neighbors)
    print("  ✓ UMAP 完了")

    print("\n[5/5] クラスタリング …")
    labels   = cluster_coords(coords, n_clusters)
    clusters = build_cluster_info(manga_list, coords, labels, tag_idf)
    print(f"  ✓ {len(clusters)} クラスタ構築")

    # ── モデルアーティファクト保存（差分同期 sync_anilist.py 用）──────────────
    import pickle
    import numpy as np

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    with open(MODEL_DIR / "umap_model.pkl", "wb") as f:
        pickle.dump(reducer, f, protocol=4)
    print("  ✓ umap_model.pkl 保存")

    with open(MODEL_DIR / "norm_params.json", "w", encoding="utf-8") as f:
        json.dump(norm_params, f)
    print("  ✓ norm_params.json 保存")

    # タグ語彙（IDF と同じ sorted(idf.keys())）
    tag_vocab = sorted(tag_idf.keys())
    with open(MODEL_DIR / "tag_vocab.json", "w", encoding="utf-8") as f:
        json.dump(tag_vocab, f, ensure_ascii=False)
    print(f"  ✓ tag_vocab.json ({len(tag_vocab)} タグ)")

    # 正規化済み 3D 座標行列（新規点の kNN に使用）
    np.save(MODEL_DIR / "coords.npy", coords.astype(np.float32))

    # 座標と対応する ID リスト（インデックスの対応を保つ）
    manga_ids = [m["id"] for m in manga_list]
    with open(MODEL_DIR / "manga_ids.json", "w", encoding="utf-8") as f:
        json.dump(manga_ids, f)
    print(f"  ✓ coords.npy / manga_ids.json ({len(manga_ids)} 件)")

    # 出力
    OUTPUT_DIR.mkdir(exist_ok=True)
    output = build_output(manga_list, coords, labels)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)
    shutil.copy(OUTPUT_FILE, FRONTEND_PUBLIC)
    print(f"\n✓ manga_map.json ({len(output)} 件)")

    public_dir = FRONTEND_PUBLIC.parent

    with open(public_dir / "cluster_map.json", "w", encoding="utf-8") as f:
        json.dump(clusters, f, ensure_ascii=False, indent=2)
    print(f"✓ cluster_map.json ({len(clusters)} クラスタ)")

    with open(public_dir / "tag_idf.json", "w", encoding="utf-8") as f:
        json.dump(tag_idf, f, ensure_ascii=False)
    with open(public_dir / "tag_list.json", "w", encoding="utf-8") as f:
        json.dump(tag_list, f, ensure_ascii=False)
    print(f"✓ tag_idf.json / tag_list.json")

    print("\nDone!")

if __name__ == "__main__":
    main()
