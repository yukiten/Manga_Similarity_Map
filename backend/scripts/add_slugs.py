"""
manga_map.json に slug フィールドを追加するスクリプト
=====================================================

slug は title_romaji（ない場合は title）から生成します。
重複が発生した場合は末尾に AniList ID を付加して一意にします。

使い方:
    python add_slugs.py [--input PATH] [--output PATH]

デフォルト入力: backend/output/manga_map.json または frontend/public/manga_map.json
デフォルト出力: 入力ファイルと同じパス（上書き）
"""

import argparse
import json
import re
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
BASE_DIR   = SCRIPT_DIR.parent

DATA_CANDIDATES = [
    BASE_DIR / "output" / "manga_map.json",
    BASE_DIR.parent / "frontend" / "public" / "manga_map.json",
]


def find_input_file(override: str | None) -> Path:
    if override:
        p = Path(override)
        if not p.exists():
            raise FileNotFoundError(f"ファイルが見つかりません: {p}")
        return p
    for c in DATA_CANDIDATES:
        if c.exists():
            return c
    raise FileNotFoundError("manga_map.json が見つかりません。--input で指定してください。")


def to_slug(text: str) -> str:
    """テキストを URL-safe な slug に変換する"""
    # Unicode 正規化 (NFC)
    text = unicodedata.normalize("NFC", text)
    # ASCII 以外を除去（ローマ字タイトル前提）
    text = text.encode("ascii", errors="ignore").decode("ascii")
    # 小文字化
    text = text.lower()
    # 英数字とハイフン以外をハイフンに置換
    text = re.sub(r"[^a-z0-9]+", "-", text)
    # 先頭・末尾のハイフンを除去
    text = text.strip("-")
    # 連続ハイフンを1つに
    text = re.sub(r"-{2,}", "-", text)
    return text or "untitled"


def main():
    parser = argparse.ArgumentParser(description="manga_map.json に slug を追加")
    parser.add_argument("--input",  default=None, help="入力 JSON ファイルのパス")
    parser.add_argument("--output", default=None, help="出力先パス（省略時は入力ファイルを上書き）")
    args = parser.parse_args()

    input_path  = find_input_file(args.input)
    output_path = Path(args.output) if args.output else input_path
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"読み込み中: {input_path}")
    with open(input_path, encoding="utf-8") as f:
        manga_list = json.load(f)
    print(f"作品数: {len(manga_list):,} 件")

    # スラグ生成と重複解決
    seen: dict[str, int] = {}   # slug -> 最初に使った manga index（重複検出用）
    duplicates = 0

    for manga in manga_list:
        base_text = manga.get("title_romaji") or manga.get("title") or ""
        slug = to_slug(base_text)

        if not slug or slug == "untitled":
            # ローマ字タイトルが空の場合は id をフォールバックに使う
            slug = f"manga-{manga['id']}"

        if slug in seen:
            # 重複: AniList ID をサフィックスとして付加
            slug = f"{slug}-{manga['id']}"
            duplicates += 1

        seen[slug] = manga["id"]
        manga["slug"] = slug

    print(f"スラグ生成完了（重複解決: {duplicates:,} 件）")

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(manga_list, f, ensure_ascii=False, separators=(",", ":"))

    print(f"保存完了: {output_path}")

    # サンプル表示
    print("\n--- サンプル (先頭5件) ---")
    for m in manga_list[:5]:
        print(f"  id={m['id']}  slug={m['slug']}")


if __name__ == "__main__":
    main()
