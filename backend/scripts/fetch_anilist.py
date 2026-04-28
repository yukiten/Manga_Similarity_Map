"""
AniList Data Fetcher
====================
AniList の GraphQL API からアニメ・漫画データを取得し、
backend/data/sources/anilist_manga.json に保存する。
認証不要（公開API）。

使い方:
    pip install requests
    python backend/scripts/fetch_anilist.py              # 漫画を上限まで取得
    python backend/scripts/fetch_anilist.py --resume     # 前回の続きから再開
    python backend/scripts/fetch_anilist.py --type ANIME # アニメ取得

オプション:
    --type          MANGA | ANIME  (デフォルト: MANGA)
    --sort          POPULARITY_DESC | SCORE_DESC | TRENDING_DESC  (デフォルト: POPULARITY_DESC)
    --max-pages     取得するページ数 (1ページ=50件、デフォルト: 9999 → 上限まで)
    --min-score     最低スコア足切り (0〜100、デフォルト: 0)
    --output        出力ファイルパス (デフォルト: data/sources/anilist_{type}.json)
    --no-adult      成人向けを除外 (デフォルト: 除外する)
    --resume        チェックポイントから再開（前回の続き）
    --save-every    N ページごとに途中保存（デフォルト: 10）
"""

import argparse
import json
import random
import time
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("requests が必要です: pip install requests")
    sys.exit(1)

# ── 定数 ───────────────────────────────────────────────────────────────────

ANILIST_URL     = "https://graphql.anilist.co"
PER_PAGE        = 50        # AniList の上限
RATE_LIMIT_WAIT = (1.0, 5.0)  # リクエスト間隔（秒）— ランダム範囲
RETRY_WAIT      = 60        # レート制限エラー時の待機秒数

BACKEND_DIR     = Path(__file__).parent.parent
# ソース別・種別別に保存: data/sources/anilist_manga.json など
SOURCES_DIR     = BACKEND_DIR / "data" / "sources"

# ── GraphQL クエリ ─────────────────────────────────────────────────────────

QUERY = """
query ($page: Int, $perPage: Int, $type: MediaType, $sort: [MediaSort], $isAdult: Boolean) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
    }
    media(type: $type, sort: $sort, isAdult: $isAdult) {
      id
      idMal
      title {
        romaji
        english
        native
      }
      synonyms
      description(asHtml: false)
      genres
      tags {
        name
        rank
        isMediaSpoiler
      }
      averageScore
      meanScore
      popularity
      favourites
      status
      format
      source
      countryOfOrigin
      isAdult
      chapters
      volumes
      episodes
      duration
      startDate { year month day }
      endDate   { year month day }
      coverImage { extraLarge large color }
      bannerImage
      siteUrl
    }
  }
}
"""

# ── 注目度スコアの計算 (1〜5) ───────────────────────────────────────────────

def calc_attention(popularity: int, avg_score: int | None) -> int:
    """
    AniList の popularity（リスト登録者数）をもとに 1〜5 の注目度に変換。
    popularity の目安:
        >= 200,000 → 5（現在覇権・超有名）
        >= 60,000  → 4（人気作）
        >= 15,000  → 3（中堅）
        >= 3,000   → 2（そこそこ）
        < 3,000    → 1（マイナー・旧作）
    """
    if popularity >= 200_000:
        return 5
    if popularity >= 60_000:
        return 4
    if popularity >= 15_000:
        return 3
    if popularity >= 3_000:
        return 2
    return 1

# ── 1件のデータを内部フォーマットに変換 ────────────────────────────────────

def convert(media: dict) -> dict:
    titles = media.get("title", {})
    title  = (
        titles.get("english")
        or titles.get("romaji")
        or titles.get("native")
        or "Unknown"
    )

    # あらすじ: 改行・特殊文字を整理し 600字に丸める
    synopsis = (media.get("description") or "").replace("\n", " ").replace("<br>", " ").strip()
    if len(synopsis) > 600:
        synopsis = synopsis[:597] + "…"

    genres   = media.get("genres") or []
    # タグを rank 降順に並べ、全件保持（ネタバレフラグも残す）
    tags_raw = sorted(
        media.get("tags") or [],
        key=lambda t: t.get("rank", 0),
        reverse=True,
    )
    tags = [
        {
            "name":    t["name"],
            "rank":    t.get("rank", 0),      # 関連度 % (0〜100)
            "spoiler": t.get("isMediaSpoiler", False),
        }
        for t in tags_raw
    ]

    popularity_raw = media.get("popularity") or 0
    avg_score      = media.get("averageScore")   # 0〜100 or None

    cover        = media.get("coverImage") or {}
    start        = media.get("startDate") or {}
    end          = media.get("endDate")   or {}


    return {
        "id":              str(media["id"]),
        "title":           title,
        "title_ja":        titles.get("native", ""),
        "title_romaji":    titles.get("romaji", ""),
        "synonyms":        media.get("synonyms") or [],
        "synopsis":        synopsis,
        "genres":          genres,
        "tags":            tags,           # [{"name", "rank", "spoiler"}, …]
        "genre":           genres[0].lower() if genres else "unknown",
        "source":          media.get("source", ""),       # ORIGINAL / MANGA / LIGHT_NOVEL …
        "country":         media.get("countryOfOrigin", ""),  # JP / KR / CN …
        "is_adult":        media.get("isAdult", False),
        "popularity":      calc_attention(popularity_raw, avg_score),
        "score":           avg_score,
        "mean_score":      media.get("meanScore"),
        "favourites":      media.get("favourites", 0),
        "status":          media.get("status", ""),
        "format":          media.get("format", ""),
        "chapters":        media.get("chapters"),         # manga
        "volumes":         media.get("volumes"),          # manga
        "episodes":        media.get("episodes"),         # anime
        "duration":        media.get("duration"),         # anime (分/話)
        "start_date":      start,                         # {year, month, day}
        "end_date":        end,                           # {year, month, day}
        "year":            start.get("year"),
        "cover":           cover.get("large", ""),
        "cover_xl":        cover.get("extraLarge", ""),
        "cover_color":     cover.get("color", ""),        # "#rrggbb"
        "banner":          media.get("bannerImage", ""),
        "url":             media.get("siteUrl", ""),
        # 他ソースとのマッチングに使う外部ID
        "_source":         "anilist",
        "_source_ids":     {
            "anilist": str(media["id"]),
            "mal":     str(media["idMal"]) if media.get("idMal") else None,
        },
        "_anilist_popularity": popularity_raw,
    }

# ── API リクエスト ──────────────────────────────────────────────────────────

def fetch_page(session: requests.Session, page: int, media_type: str,
               sort: str, is_adult: bool) -> tuple[list[dict], dict]:
    variables = {
        "page":    page,
        "perPage": PER_PAGE,
        "type":    media_type,
        "sort":    [sort],
        "isAdult": is_adult,
    }
    for attempt in range(5):
        resp = session.post(
            ANILIST_URL,
            json={"query": QUERY, "variables": variables},
            timeout=30,
        )
        if resp.status_code == 429:
            wait = RETRY_WAIT * (attempt + 1)
            print(f"  レート制限。{wait}秒待機中…")
            time.sleep(wait)
            continue
        if resp.status_code != 200:
            print(f"  HTTPエラー {resp.status_code}: {resp.text[:200]}")
            time.sleep(5)
            continue

        data = resp.json()
        if "errors" in data:
            for err in data["errors"]:
                print(f"  GraphQLエラー: {err.get('message')}")
            return [], {}

        page_data = data["data"]["Page"]
        return page_data["media"], page_data["pageInfo"]

    print("  リトライ上限に達しました。スキップします。")
    return [], {}

# ── チェックポイント ───────────────────────────────────────────────────────────

def checkpoint_path(output_path: Path) -> Path:
    return output_path.with_suffix(".checkpoint.json")

def load_checkpoint(cp_path: Path) -> dict | None:
    if not cp_path.exists():
        return None
    with open(cp_path, encoding="utf-8") as f:
        return json.load(f)

def save_checkpoint(cp_path: Path, next_page: int, total: int):
    with open(cp_path, "w", encoding="utf-8") as f:
        json.dump({"next_page": next_page, "total": total}, f)

def clear_checkpoint(cp_path: Path):
    if cp_path.exists():
        cp_path.unlink()

# ── メイン ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AniList データ取得スクリプト")
    parser.add_argument("--type",       default="MANGA",
                        choices=["MANGA", "ANIME"],
                        help="取得するメディア種別")
    parser.add_argument("--sort",       default="POPULARITY_DESC",
                        choices=["POPULARITY_DESC", "SCORE_DESC", "TRENDING_DESC"],
                        help="ソート順")
    parser.add_argument("--max-pages",  type=int, default=9999,
                        help="取得するページ数上限 (デフォルト: 9999 = 上限まで)")
    parser.add_argument("--min-score",  type=int, default=0,
                        help="最低スコア足切り (0〜100)")
    parser.add_argument("--output",     default=None,
                        help="出力 JSON ファイルパス（省略時: data/sources/anilist_{type}.json）")
    parser.add_argument("--no-adult",   action="store_true", default=True,
                        help="成人向けコンテンツを除外（デフォルト: 除外）")
    parser.add_argument("--resume",     action="store_true",
                        help="チェックポイントから再開（前回の続き）")
    parser.add_argument("--save-every", type=int, default=10,
                        help="N ページごとに途中保存（デフォルト: 10）")
    args = parser.parse_args()

    # 出力先
    if args.output:
        output_path = Path(args.output)
    else:
        SOURCES_DIR.mkdir(parents=True, exist_ok=True)
        output_path = SOURCES_DIR / f"anilist_{args.type.lower()}.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cp_path  = checkpoint_path(output_path)
    is_adult = not args.no_adult

    # ── 再開 or 新規 ──────────────────────────────────────────────────────
    start_page  = 1
    all_items: list[dict] = []

    if args.resume and cp_path.exists():
        cp = load_checkpoint(cp_path)
        start_page = cp["next_page"]
        # 既存の出力ファイルを読み込んで続きに追記
        if output_path.exists():
            with open(output_path, encoding="utf-8") as f:
                all_items = json.load(f)
        print(f"=== チェックポイントから再開 ===")
        print(f"  再開ページ: {start_page}  既存データ: {len(all_items)} 件")
    elif args.resume:
        print("チェックポイントが見つかりません。最初から取得します。")

    print(f"=== AniList フェッチ{'再開' if args.resume and start_page > 1 else '開始'} ===")
    print(f"  種別: {args.type} / ソート: {args.sort}")
    print(f"  開始ページ: {start_page} / 上限: {args.max_pages}")
    print(f"  出力先: {output_path}")
    print(f"  チェックポイント: {cp_path.name} ({args.save_every}ページごと)")
    print()

    session = requests.Session()
    session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})

    completed  = False   # True = hasNextPage:false で自然終了
    last_page  = start_page - 1

    for page_num in range(start_page, args.max_pages + 1):
        last_page = page_num
        print(f"  ページ {page_num} 取得中…", end=" ", flush=True)
        media_list, page_info = fetch_page(session, page_num, args.type, args.sort, is_adult)

        if not media_list:
            # APIエラー or 本当にデータなし
            # チェックポイントをこのページに残して中断（--resume で同ページから再試行可能）
            print("データなし。中断します。")
            _save(output_path, all_items)
            save_checkpoint(cp_path, page_num, len(all_items))
            print(f"  → チェックポイント保存（ページ {page_num} から再開可能）")
            break

        converted = [convert(m) for m in media_list]
        if args.min_score > 0:
            converted = [m for m in converted if (m["score"] or 0) >= args.min_score]

        all_items.extend(converted)
        print(f"{len(converted)} 件取得 (累計: {len(all_items)})")

        # N ページごとに途中保存 + チェックポイント更新
        if page_num % args.save_every == 0:
            _save(output_path, all_items)
            save_checkpoint(cp_path, page_num + 1, len(all_items))
            print(f"  → 途中保存 (ページ {page_num} 完了、次回は {page_num + 1} から)")

        if not page_info.get("hasNextPage", False):
            print("  最終ページに到達。")
            completed = True
            break

        time.sleep(random.uniform(*RATE_LIMIT_WAIT))

    # 最終保存
    _save(output_path, all_items)

    if completed:
        # 正常完了 → チェックポイント不要
        clear_checkpoint(cp_path)
        print(f"\n✓ 完了: {len(all_items)} 件 → {output_path}")
        print("  チェックポイントを削除しました。")
    else:
        # エラー or max_pages 到達 → チェックポイント保持
        save_checkpoint(cp_path, last_page + 1, len(all_items))
        print(f"\n✓ 保存: {len(all_items)} 件 → {output_path}")
        print(f"  続きから再開するには: python backend/scripts/fetch_anilist.py --resume")

    print()
    print("次のステップ:")
    print("  python backend/scripts/merge_sources.py        # ソースをマージ")
    print("  python backend/scripts/generate_embeddings.py  # 座標生成")


def _save(output_path: Path, items: list[dict]):
    """重複除去して保存"""
    seen, unique = set(), []
    for item in items:
        if item["id"] not in seen:
            seen.add(item["id"])
            unique.append(item)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
