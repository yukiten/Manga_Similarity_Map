"""
manga_map.json から DetailPanel 専用フィールドを除去した軽量版を生成するスクリプト
====================================================================================
Usage:
    python backend/scripts/build_light_json.py
    python backend/scripts/build_light_json.py --input path/to/manga_map.json --output path/to/output.json
"""
import argparse
import gzip
import json
from pathlib import Path

# DetailPanel で API から取得するため、初期ロードには不要なフィールド
EXCLUDE_FIELDS = {
    "synopsis",
    "synopsis_ja",
    "affiliate_url",
    "url",
    "isbn",
    "author",
    "publisher",
    "sales_date",
    "review_average",
    "review_count",
}

DEFAULT_INPUT  = Path(__file__).parent.parent.parent / "frontend" / "public" / "manga_map.json"
DEFAULT_OUTPUT = Path(__file__).parent.parent.parent / "frontend" / "public" / "manga_map_light.json"


def build(input_path: Path, output_path: Path):
    print(f"読み込み中: {input_path}")
    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    print(f"エントリ数: {len(data)}")
    light = [{k: v for k, v in entry.items() if k not in EXCLUDE_FIELDS} for entry in data]

    # JSON 書き出し
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(light, f, ensure_ascii=False, separators=(",", ":"))
    size_json = output_path.stat().st_size

    # gzip 版も生成
    gz_path = Path(str(output_path) + ".gz")
    with open(output_path, "rb") as f_in, gzip.open(gz_path, "wb", compresslevel=9) as f_out:
        f_out.write(f_in.read())
    size_gz = gz_path.stat().st_size

    orig_size = input_path.stat().st_size
    print(f"元サイズ:     {orig_size / 1024 / 1024:.1f} MB")
    print(f"軽量版:       {size_json / 1024 / 1024:.1f} MB ({100 - size_json * 100 // orig_size}% 削減)")
    print(f"軽量版+gzip:  {size_gz / 1024 / 1024:.1f} MB ({100 - size_gz * 100 // orig_size}% 削減)")
    print(f"出力: {output_path}")
    print(f"出力: {gz_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="manga_map.json の軽量版を生成")
    parser.add_argument("--input",  type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    build(args.input, args.output)
