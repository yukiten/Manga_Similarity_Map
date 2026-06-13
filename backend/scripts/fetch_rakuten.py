"""
楽天Books API でマンガの書影・アフィリエイトURLを取得し、manga_map.json にマージするスクリプト
================================================================================================

使い方:
    python fetch_rakuten.py --app-id YOUR_APP_ID --access-key YOUR_ACCESS_KEY --affiliate-id YOUR_AFFILIATE_ID

オプション:
    --app-id       楽天アプリID（必須）UUID形式 例: e5e2671a-b454-4e6f-xxxx-xxxxxxxxxxxx
    --access-key   楽天アクセスキー（必須）2026年2月移行より両方必須
    --affiliate-id 楽天アフィリエイトID（必須）
    --input        入力 manga_map.json のパス（省略時は自動検出）
    --qps          1秒あたりのリクエスト数（デフォルト: 1）
    --resume       チェックポイントから再開する

完了後:
    manga_map.json に image_url / affiliate_url / isbn / author / publisher 等が追加されます。
    チェックポイントファイル（rakuten_checkpoint.json）は取得中の一時ファイルです。
    
実行コード例

"""

import argparse
import json
import random
import re
import time
from pathlib import Path

import requests

# ── 楽天Books API 設定 ────────────────────────────────────────────────────────
API_URL = "https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404"

# 2026年2月移行: 新APIはレート制限が厳しくなったため最低1.5秒を保証する
MIN_SLEEP_SEC = 1.5

# ── ファイルパス ──────────────────────────────────────────────────────────────
SCRIPT_DIR      = Path(__file__).parent
BASE_DIR        = SCRIPT_DIR.parent
CHECKPOINT_FILE = BASE_DIR / "data" / "rakuten_checkpoint.json"

DATA_CANDIDATES = [
    BASE_DIR / "output" / "manga_map.json",
    BASE_DIR.parent / "frontend" / "public" / "manga_map.json",
]

RAKUTEN_FIELDS = (
    "image_url", "affiliate_url", "isbn",
    "author", "publisher", "sales_date",
    "review_average", "review_count", "synopsis_ja",
)


def find_input_file(override: str | None) -> Path:
    if override:
        p = Path(override)
        if not p.exists():
            raise FileNotFoundError(f"指定されたファイルが見つかりません: {p}")
        return p
    for candidate in DATA_CANDIDATES:
        if candidate.exists():
            return candidate
    raise FileNotFoundError("manga_map.json が見つかりません。--input で指定してください。")


def normalize_title(title: str) -> str:
    """タイトルから巻数・記号以降を除去して検索精度を上げる"""
    title = re.sub(r"\s+", " ", title).strip()
    # 末尾の巻数を除去（例: "キングダム 72" → "キングダム"）
    title = re.sub(r"[ 　]*(\d+巻?|第?\d+巻)$", "", title)
    # コロン・括弧以降を除去（例: "タイトル（副題）" → "タイトル"）
    title = re.split(r"[:：｜|（(]", title)[0].strip()
    return title


def search_rakuten(title: str, app_id: str, access_key: str, affiliate_id: str, origin: str) -> dict | None:
    """楽天Books APIでタイトル検索し、最初のヒットを返す（429時はリトライ）"""
    search_title = normalize_title(title)

    params = {
        "applicationId": app_id,
        "accessKey":     access_key,
        "affiliateId":   affiliate_id,
        "title":         search_title,
        "hits":          3,
        "format":        "json",
        # booksGenreId は指定しない（階層が深く絞りすぎると漏れが増えるため）
    }

    for attempt in range(4):
        try:
            # 2026年2月移行: Referer/Origin ヘッダーが両方必須
            resp = requests.get(API_URL, params=params, timeout=15,
                                headers={"Referer": origin + "/", "Origin": origin})

            if resp.status_code == 429:
                wait = 15 * (attempt + 1)  # 15s → 30s → 45s → 60s
                print(f"  429 待機 {wait}s ...", end=" ", flush=True)
                time.sleep(wait)
                continue

            resp.raise_for_status()
            data  = resp.json()
            items = data.get("Items", [])
            if not items:
                return None

            item = items[0]["Item"]
            return {
                "isbn":           item.get("isbn", ""),
                # affiliateUrl が空の場合は itemUrl で代替
                "affiliate_url":  item.get("affiliateUrl") or item.get("itemUrl", ""),
                "image_url":      item.get("largeImageUrl", ""),
                "author":         item.get("author", ""),
                "publisher":      item.get("publisherName", ""),
                "sales_date":     item.get("salesDate", ""),
                "review_average": item.get("reviewAverage", ""),
                "review_count":   item.get("reviewCount", 0),
                "synopsis_ja":    item.get("itemCaption", ""),
            }

        except Exception as e:
            print(f"  エラー: {e}")
            return None

    print("  リトライ上限到達")
    return None


def merge_into_manga_map(manga_list: list, results: dict, input_path: Path) -> int:
    """取得した楽天データを manga_map.json の各エントリに直接書き込む"""
    slug_index = {(m.get("slug") or str(m["id"])): i for i, m in enumerate(manga_list)}
    merged = 0
    for slug, rakuten in results.items():
        idx = slug_index.get(slug)
        if idx is None:
            continue
        for field in RAKUTEN_FIELDS:
            if rakuten.get(field):
                manga_list[idx][field] = rakuten[field]
        merged += 1

    with open(input_path, "w", encoding="utf-8") as f:
        json.dump(manga_list, f, ensure_ascii=False, separators=(",", ":"))
    return merged


def main():
    parser = argparse.ArgumentParser(description="楽天BooksAPIでマンガデータを取得してmanga_map.jsonにマージ")
    parser.add_argument("--app-id",       required=True,               help="楽天アプリID")
    parser.add_argument("--access-key",   required=True,               help="楽天アクセスキー")
    parser.add_argument("--affiliate-id", required=True,               help="楽天アフィリエイトID")
    parser.add_argument("--origin",       required=True,               help="アプリ登録時の許可ドメイン (例: https://ruima.vercel.app)")
    parser.add_argument("--input",        default=None,                 help="manga_map.jsonのパス")
    parser.add_argument("--qps",          type=float, default=1.0,     help="リクエスト数/秒（デフォルト: 1）")
    parser.add_argument("--resume",       action="store_true",         help="チェックポイントから再開")
    args = parser.parse_args()

    sleep_sec = 1.0 / args.qps

    # ── 入力ファイル読み込み ─────────────────────────────────────────────────
    input_path = find_input_file(args.input)
    print(f"入力ファイル: {input_path}")
    with open(input_path, encoding="utf-8") as f:
        manga_list = json.load(f)
    total = len(manga_list)
    print(f"作品数: {total:,}件")
    print(f"QPS: {args.qps} （推定 {total / args.qps / 3600:.1f} 時間）\n")

    # ── チェックポイント読み込み ─────────────────────────────────────────────
    results     = {}
    start_index = 0
    if args.resume and CHECKPOINT_FILE.exists():
        with open(CHECKPOINT_FILE, encoding="utf-8") as f:
            ckpt = json.load(f)
        results     = ckpt.get("results", {})
        start_index = ckpt.get("index", 0)
        print(f"チェックポイントから再開: {start_index:,}件目 / 取得済み {len(results):,}件\n")

    # ── メインループ ─────────────────────────────────────────────────────────
    matched   = len(results)
    unmatched = 0

    for i, manga in enumerate(manga_list[start_index:], start=start_index):
        manga_id = manga.get("slug") or str(manga["id"])
        title    = manga.get("title_ja") or manga.get("title", "")

        print(f"[{i+1:>6}/{total}] {title[:30]:<30}", end=" ", flush=True)

        result = search_rakuten(title, args.app_id, args.access_key, args.affiliate_id, args.origin)

        # affiliateUrl が空でも result があれば成功扱い（画像・ISBNは取れている）
        if result:
            results[manga_id] = result
            matched += 1
            print(f"✓  {result.get('author', '')[:20]}")
        else:
            unmatched += 1
            print("✗  未マッチ")

        # チェックポイント保存（1,000件ごと）
        if (i + 1) % 1000 == 0:
            _save_checkpoint(i + 1, results)
            elapsed_h = (i + 1 - start_index) * sleep_sec / 3600
            remain_h  = (total - i - 1) * sleep_sec / 3600
            print(f"\n  ── チェックポイント保存: {i+1:,}件"
                  f" | 経過 {elapsed_h:.1f}h | 残り約 {remain_h:.1f}h\n")

        # ±30% のゆらぎを加えてレート制限を回避（新APIは最低1.5秒必須）
        time.sleep(max(sleep_sec * random.uniform(0.7, 1.3), MIN_SLEEP_SEC))

    # ── manga_map.json にマージして保存 ──────────────────────────────────────
    print(f"\n{'='*60}")
    print("manga_map.json にマージ中...")
    merged = merge_into_manga_map(manga_list, results, input_path)

    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()
        print("チェックポイントファイルを削除しました")

    print(f"\n完了")
    print(f"  マッチ:   {matched:,} 件 ({matched/total*100:.1f}%)")
    print(f"  未マッチ: {unmatched:,} 件 ({unmatched/total*100:.1f}%)")
    print(f"  マージ済: {merged:,} 件")
    print(f"  出力先:   {input_path}")
    print(f"\n次のステップ:")
    print(f"  cp {input_path} {input_path.parent.parent / 'frontend' / 'public' / 'manga_map.json'}")


def _save_checkpoint(index: int, results: dict):
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CHECKPOINT_FILE, "w", encoding="utf-8") as f:
        json.dump({"index": index, "results": results}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
