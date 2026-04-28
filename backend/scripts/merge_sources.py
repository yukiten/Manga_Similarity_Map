"""
Sources Merger
==============
data/sources/ 以下の全ソースファイルを読み込み、
同一作品をマージして data/merged.json を出力する。

同一作品の判定:
  1. _source_ids に共通の外部ID（mal, anilist など）がある
  2. 正規化タイトルが一致

マージ優先度（フィールドごとに最良ソースを選択）:
  - synopsis: 最も長いものを採用
  - score: ソース別スコアを保持し、平均を計算
  - tags: 全ソースのタグをユニオン
  - popularity: 最大値を採用

使い方:
    python backend/scripts/merge_sources.py
    python backend/scripts/merge_sources.py --sources-dir path/to/sources
"""

import argparse
import json
import re
from pathlib import Path

BACKEND_DIR  = Path(__file__).parent.parent
SOURCES_DIR  = BACKEND_DIR / "data" / "sources"
MERGED_FILE  = BACKEND_DIR / "data" / "merged.json"


def normalize_title(title: str) -> str:
    """タイトルを正規化（小文字・記号除去）して比較キーにする"""
    t = title.lower()
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def load_sources(sources_dir: Path) -> list[tuple[str, list[dict]]]:
    """sources/ 以下の全 JSON ファイルを読み込む（チェックポイントファイルは除外）"""
    results = []
    for path in sorted(sources_dir.glob("*.json")):
        if ".checkpoint" in path.name:
            print(f"  スキップ: {path.name} (チェックポイントファイル)")
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            print(f"  スキップ: {path.name} (リスト形式でない)")
            continue
        print(f"  読み込み: {path.name} ({len(data)} 件)")
        results.append((path.stem, data))
    return results


def build_lookup(items: list[dict]) -> dict:
    """
    マージ済みアイテムから検索用インデックスを構築。
    キー: 外部ID文字列 ("anilist:12345", "mal:678" など) またはタイトル正規化形
    値: merged list のインデックス
    """
    by_ext_id: dict[str, int] = {}   # "source:id" → index
    by_title: dict[str, int] = {}    # normalized_title → index
    return by_ext_id, by_title


def find_existing(item: dict, merged: list[dict],
                  by_ext_id: dict, by_title: dict) -> int | None:
    """マージ済みリストから同一作品のインデックスを探す"""
    source_ids: dict = item.get("_source_ids", {})

    # 1. 外部IDで照合
    for source, sid in source_ids.items():
        if sid is None:
            continue
        key = f"{source}:{sid}"
        if key in by_ext_id:
            return by_ext_id[key]

    # 2. タイトルで照合
    norm = normalize_title(item.get("title", ""))
    if norm and norm in by_title:
        return by_title[norm]

    return None


def register(index: int, item: dict, by_ext_id: dict, by_title: dict):
    """新しいアイテムをインデックスに登録"""
    source_ids: dict = item.get("_source_ids", {})
    for source, sid in source_ids.items():
        if sid:
            by_ext_id[f"{source}:{sid}"] = index
    norm = normalize_title(item.get("title", ""))
    if norm:
        by_title[norm] = index


def merge_into(existing: dict, incoming: dict) -> dict:
    """
    existing に incoming の情報をマージする。
    各フィールドの戦略:
      - synopsis: より長いほうを採用
      - tags: ユニオン（既存の順序を維持し、新規のみ追加）
      - popularity: 最大値
      - score: ソース別に保持
      - _source_ids: マージ
      - _scores: ソース別スコアを蓄積
    """
    # synopsis: 長いほうを採用
    if len(incoming.get("synopsis", "")) > len(existing.get("synopsis", "")):
        existing["synopsis"] = incoming["synopsis"]

    # tags: ユニオン
    existing_tags = existing.get("tags", [])
    for t in incoming.get("tags", []):
        if t not in existing_tags:
            existing_tags.append(t)
    existing["tags"] = existing_tags
    if existing_tags and not existing.get("genre"):
        existing["genre"] = existing_tags[0]

    # popularity: 最大値
    existing["popularity"] = max(
        existing.get("popularity", 0),
        incoming.get("popularity", 0),
    )

    # score: ソース別に保持し、平均を再計算
    scores: dict = existing.setdefault("_scores", {})
    if incoming.get("score") is not None:
        scores[incoming.get("_source", "unknown")] = incoming["score"]
    if scores:
        existing["score"] = round(sum(scores.values()) / len(scores), 1)

    # year: 最も古い（最初の）年を採用
    existing_year = existing.get("year")
    incoming_year = incoming.get("year")
    if incoming_year and (not existing_year or incoming_year < existing_year):
        existing["year"] = incoming_year

    # cover: なければ補完
    if not existing.get("cover") and incoming.get("cover"):
        existing["cover"] = incoming["cover"]

    # url: なければ補完
    if not existing.get("url") and incoming.get("url"):
        existing["url"] = incoming["url"]

    # _source_ids: マージ
    existing_ids: dict = existing.setdefault("_source_ids", {})
    for source, sid in incoming.get("_source_ids", {}).items():
        if sid and source not in existing_ids:
            existing_ids[source] = sid

    # _sources: どのソースから来たか記録
    existing_sources: list = existing.setdefault("_sources", [])
    src = incoming.get("_source")
    if src and src not in existing_sources:
        existing_sources.append(src)

    return existing


def merge_all(sources: list[tuple[str, list[dict]]]) -> list[dict]:
    merged: list[dict] = []
    by_ext_id: dict[str, int] = {}
    by_title: dict[str, int] = {}

    for source_name, items in sources:
        added = 0
        merged_count = 0
        for item in items:
            idx = find_existing(item, merged, by_ext_id, by_title)
            if idx is None:
                # 新規追加
                new_item = dict(item)
                new_item.setdefault("_sources", [item.get("_source", source_name)])
                new_item.setdefault("_scores", {})
                if item.get("score") is not None:
                    new_item["_scores"][item.get("_source", source_name)] = item["score"]
                merged.append(new_item)
                register(len(merged) - 1, new_item, by_ext_id, by_title)
                added += 1
            else:
                # 既存にマージ
                merged[idx] = merge_into(merged[idx], item)
                merged_count += 1

        print(f"  {source_name}: 新規 {added} 件 / マージ {merged_count} 件")

    return merged


def clean_output(items: list[dict]) -> list[dict]:
    """内部フィールド（_で始まるもの）を除いた出力用データを返す"""
    result = []
    for item in items:
        cleaned = {k: v for k, v in item.items() if not k.startswith("_")}
        # _source_ids だけは残す（他ツールとの連携用）
        if "_source_ids" in item:
            cleaned["source_ids"] = item["_source_ids"]
        if "_sources" in item:
            cleaned["sources"] = item["_sources"]
        result.append(cleaned)
    return result


def main():
    parser = argparse.ArgumentParser(description="ソースデータをマージ")
    parser.add_argument("--sources-dir", default=str(SOURCES_DIR),
                        help="ソースファイルのディレクトリ")
    parser.add_argument("--output", default=str(MERGED_FILE),
                        help="出力ファイルパス")
    args = parser.parse_args()

    sources_dir = Path(args.sources_dir)
    output_path = Path(args.output)

    if not sources_dir.exists():
        print(f"ソースディレクトリが見つかりません: {sources_dir}")
        print("先に fetch_anilist.py を実行してください。")
        return

    json_files = list(sources_dir.glob("*.json"))
    if not json_files:
        print(f"{sources_dir} に JSON ファイルがありません。")
        return

    print(f"=== ソースマージ開始 ===")
    print(f"  ソースディレクトリ: {sources_dir}")
    print()

    sources = load_sources(sources_dir)
    print()

    merged = merge_all(sources)
    print(f"\n合計 {len(merged)} 件（ユニーク作品）")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output = clean_output(merged)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    print(f"✓ {output_path} に保存しました。")
    print()
    print("次のステップ:")
    print("  python backend/scripts/generate_embeddings.py  # 座標生成")


if __name__ == "__main__":
    main()
