"""
Cover Image Downloader
======================
manga_map.json に含まれるカバー画像 URL を一括ダウンロードし、
frontend/public/covers/{id}.jpg に保存する。

サービス運用時は imageSource.js の SOURCE を 'local' に変えることで
AniList CDN への依存をなくせる。

使い方:
    pip install requests
    python backend/scripts/download_covers.py

オプション:
    --input    入力 JSON（デフォルト: frontend/public/manga_map.json）
    --output   保存先ディレクトリ（デフォルト: frontend/public/covers）
    --delay    リクエスト間の最小待機秒数（デフォルト: 1.0）
    --jitter   待機に加えるランダム上乗せ秒数の最大値（デフォルト: 2.0）
    --workers  並列ダウンロード数（デフォルト: 2、最大 4 を推奨）
    --skip-existing  既にファイルがある場合はスキップ（デフォルト: True）
    --force    既存ファイルを上書きする（--skip-existing を無効化）

注意:
    - workers を増やすほど CDN への負荷が高まります。
    - CDN が 429 を返した場合は自動でリトライ＆バックオフします。
    - AniList CDN の URL は時間が経つと失効することがあります。
      定期的な再ダウンロードには fetch_anilist.py で最新データを取得してください。
"""

import argparse
import json
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import Lock

try:
    import requests
except ImportError:
    print("requests が必要です: pip install requests")
    sys.exit(1)

# ── 定数 ───────────────────────────────────────────────────────────────────

DEFAULT_INPUT   = Path(__file__).parent.parent.parent / "frontend" / "public" / "manga_map.json"
DEFAULT_OUTPUT  = Path(__file__).parent.parent.parent / "frontend" / "public" / "covers"

# リクエストヘッダー（ブラウザらしく見せる）
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; manga-search-map/1.0; cover downloader)",
    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "Referer": "https://anilist.co/",
}

MAX_WORKERS_LIMIT = 4   # CDN 負荷を考慮した上限
RETRY_MAX         = 3   # 1ファイルあたりの最大リトライ回数
RETRY_BASE_WAIT   = 30  # 429 受信時の基本待機秒（× 試行回数）

# ── スレッド間で共有するレート制限ロック ───────────────────────────────────

_rate_lock      = Lock()
_last_request_t = 0.0   # 最後にリクエストを飛ばした時刻

def _wait_rate_limit(min_delay: float, jitter: float):
    """
    スレッド間で協調してリクエスト間隔を守る。
    min_delay + random(0, jitter) 秒を最小間隔として保証する。
    """
    global _last_request_t
    with _rate_lock:
        now    = time.monotonic()
        wait   = (_last_request_t + min_delay + random.uniform(0, jitter)) - now
        if wait > 0:
            time.sleep(wait)
        _last_request_t = time.monotonic()

# ── 1ファイルのダウンロード ─────────────────────────────────────────────────

def download_one(session: requests.Session, manga_id: str, url: str,
                 out_dir: Path, skip_existing: bool,
                 min_delay: float, jitter: float) -> tuple[str, str]:
    """
    1枚のカバー画像をダウンロードして保存する。

    戻り値: (manga_id, status)
        status: 'ok' | 'skipped' | 'no_url' | 'error'
    """
    if not url:
        return manga_id, "no_url"

    # 拡張子を URL から推測（なければ .jpg）
    url_path = url.split("?")[0]
    suffix   = Path(url_path).suffix.lower()
    if suffix not in (".jpg", ".jpeg", ".png", ".webp"):
        suffix = ".jpg"

    dest = out_dir / f"{manga_id}{suffix}"

    if skip_existing and dest.exists() and dest.stat().st_size > 0:
        return manga_id, "skipped"

    for attempt in range(1, RETRY_MAX + 1):
        _wait_rate_limit(min_delay, jitter)

        try:
            resp = session.get(url, timeout=20, stream=True)
        except requests.RequestException as e:
            if attempt == RETRY_MAX:
                return manga_id, f"error: {e}"
            time.sleep(5 * attempt)
            continue

        if resp.status_code == 429:
            wait = RETRY_BASE_WAIT * attempt
            print(f"  [{manga_id}] 429 Too Many Requests — {wait}秒待機 (試行 {attempt}/{RETRY_MAX})")
            time.sleep(wait)
            continue

        if resp.status_code == 404:
            return manga_id, "error: 404 Not Found"

        if resp.status_code != 200:
            if attempt == RETRY_MAX:
                return manga_id, f"error: HTTP {resp.status_code}"
            time.sleep(5 * attempt)
            continue

        # ストリーミング書き込み（大きなファイルでもメモリを使いすぎない）
        try:
            with open(dest, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
        except OSError as e:
            return manga_id, f"error: write failed ({e})"

        return manga_id, "ok"

    return manga_id, "error: max retries exceeded"

# ── メイン ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="カバー画像一括ダウンロード")
    parser.add_argument("--input",         default=str(DEFAULT_INPUT),
                        help="入力 manga_map.json のパス")
    parser.add_argument("--output",        default=str(DEFAULT_OUTPUT),
                        help="保存先ディレクトリ")
    parser.add_argument("--delay",         type=float, default=1.0,
                        help="リクエスト間の最小待機秒数（デフォルト: 1.0）")
    parser.add_argument("--jitter",        type=float, default=2.0,
                        help="待機に加えるランダム上乗せ秒数の最大値（デフォルト: 2.0）")
    parser.add_argument("--workers",       type=int,   default=2,
                        help=f"並列ダウンロード数（デフォルト: 2、上限: {MAX_WORKERS_LIMIT}）")
    parser.add_argument("--force",         action="store_true",
                        help="既存ファイルを上書きする")
    args = parser.parse_args()

    skip_existing = not args.force
    workers       = max(1, min(args.workers, MAX_WORKERS_LIMIT))
    min_delay     = max(0.2, args.delay)   # 0.2秒未満は受け付けない

    # ── 入力読み込み ──────────────────────────────────────────────────────
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"入力ファイルが見つかりません: {input_path}")
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        data = json.load(f)

    # cover フィールドを持つ作品だけ対象
    targets = [(m["id"], m.get("cover") or m.get("cover_xl") or "") for m in data]
    has_url = [(mid, url) for mid, url in targets if url]
    no_url  = [mid for mid, url in targets if not url]

    # ── 出力ディレクトリ準備 ─────────────────────────────────────────────
    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== カバー画像ダウンロード開始 ===")
    print(f"  入力: {input_path}  ({len(data)} 件)")
    print(f"  URL あり: {len(has_url)} 件 / URL なし: {len(no_url)} 件")
    print(f"  保存先: {out_dir}")
    print(f"  並列数: {workers} / 最小間隔: {min_delay}s + jitter 0〜{args.jitter}s")
    print(f"  既存スキップ: {'はい' if skip_existing else 'いいえ（上書き）'}")
    print()

    session = requests.Session()
    session.headers.update(HEADERS)

    counts = {"ok": 0, "skipped": 0, "no_url": 0, "error": 0}
    errors = []
    total  = len(targets)
    done   = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                download_one, session, mid, url, out_dir,
                skip_existing, min_delay, args.jitter
            ): mid
            for mid, url in targets
        }

        for future in as_completed(futures):
            manga_id, status = future.result()
            done += 1

            if status == "ok":
                counts["ok"] += 1
                label = "✓"
            elif status == "skipped":
                counts["skipped"] += 1
                label = "–"
            elif status == "no_url":
                counts["no_url"] += 1
                label = "?"
            else:
                counts["error"] += 1
                errors.append((manga_id, status))
                label = "✗"

            # 進捗表示（10件ごと、またはエラー時は即時）
            if status.startswith("error") or done % 10 == 0 or done == total:
                pct = done / total * 100
                print(f"  [{done:4d}/{total}] {pct:5.1f}%  {label} {manga_id}"
                      + (f"  → {status}" if status.startswith("error") else ""))

    print()
    print(f"=== 完了 ===")
    print(f"  ダウンロード成功 : {counts['ok']}")
    print(f"  スキップ（既存） : {counts['skipped']}")
    print(f"  URL なし         : {counts['no_url']}")
    print(f"  エラー           : {counts['error']}")

    if errors:
        print()
        print("エラー詳細:")
        for mid, status in errors:
            print(f"  {mid}: {status}")

    print()
    print("次のステップ:")
    print("  imageSource.js の SOURCE を 'local' に変更してください。")
    print("  本番環境では covers/ ディレクトリを自前CDNにアップロードすることを推奨します。")


if __name__ == "__main__":
    main()
