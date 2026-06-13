#!/usr/bin/env python3
"""
run_sync.py — AniList 差分同期の定期実行スケジューラー

使い方:
    python run_sync.py                   # デフォルト: 毎日 03:00 に実行
    python run_sync.py --interval 12     # 12 時間ごとに実行
    python run_sync.py --once            # 1 回だけ実行して終了
    python run_sync.py --dry-run         # sync_anilist.py に --dry-run を渡す
"""

import argparse
import logging
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

# ── ロギング設定 ──────────────────────────────────────────────────────────────

LOG_DIR = Path(__file__).parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_DIR / "sync.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── スクリプトパス ────────────────────────────────────────────────────────────

SYNC_SCRIPT = Path(__file__).parent / "sync_anilist.py"


# ─────────────────────────────────────────────────────────────────────────────

def run_once(dry_run: bool = False, extra_args: list[str] | None = None) -> bool:
    """sync_anilist.py を 1 回実行。成功すれば True を返す。"""
    cmd = [sys.executable, str(SYNC_SCRIPT)]
    if dry_run:
        cmd.append("--dry-run")
    if extra_args:
        cmd.extend(extra_args)

    log.info("同期開始: %s", " ".join(cmd))
    start = time.monotonic()

    try:
        result = subprocess.run(
            cmd,
            capture_output=False,   # stdout/stderr をそのままターミナルに流す
            check=False,
        )
        elapsed = time.monotonic() - start
        if result.returncode == 0:
            log.info("同期完了 (%.1f 秒)", elapsed)
            return True
        else:
            log.error("同期スクリプトが終了コード %d で終了 (%.1f 秒)", result.returncode, elapsed)
            return False
    except FileNotFoundError:
        log.error("sync_anilist.py が見つかりません: %s", SYNC_SCRIPT)
        return False
    except Exception as exc:
        log.exception("同期中に予期しないエラー: %s", exc)
        return False


def schedule_loop(interval_hours: float, dry_run: bool, extra_args: list[str]) -> None:
    """interval_hours ごとに run_once() を繰り返す。Ctrl-C で終了。"""
    interval_sec = interval_hours * 3600
    log.info("スケジューラー起動 — %g 時間ごとに実行 (Ctrl-C で停止)", interval_hours)

    # 起動直後に 1 回実行
    run_once(dry_run=dry_run, extra_args=extra_args)

    while True:
        next_run = datetime.now().replace(microsecond=0)
        log.info("次回実行まで %.0f 秒 (%g 時間) スリープ", interval_sec, interval_hours)
        try:
            time.sleep(interval_sec)
        except KeyboardInterrupt:
            log.info("Ctrl-C を受信 — 終了します")
            break

        run_once(dry_run=dry_run, extra_args=extra_args)


# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="AniList 差分同期の定期実行スケジューラー"
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=24.0,
        metavar="HOURS",
        help="実行間隔（時間）。デフォルト 24（毎日）",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="1 回だけ実行して終了",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="sync_anilist.py に --dry-run を渡す（DB/JSON を変更しない）",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=None,
        metavar="N",
        help="sync_anilist.py に --days N を渡す（初回の差分取得期間）",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="sync_anilist.py に --limit N を渡す（1 回あたりの最大取得件数）",
    )
    parser.add_argument(
        "--db-url",
        default=None,
        metavar="URL",
        help="sync_anilist.py に --db-url を渡す",
    )
    args = parser.parse_args()

    # sync_anilist.py に転送する追加オプションを組み立てる
    extra: list[str] = []
    if args.days is not None:
        extra += ["--days", str(args.days)]
    if args.limit is not None:
        extra += ["--limit", str(args.limit)]
    if args.db_url is not None:
        extra += ["--db-url", args.db_url]

    if args.once:
        success = run_once(dry_run=args.dry_run, extra_args=extra)
        sys.exit(0 if success else 1)
    else:
        try:
            schedule_loop(
                interval_hours=args.interval,
                dry_run=args.dry_run,
                extra_args=extra,
            )
        except KeyboardInterrupt:
            log.info("終了")


if __name__ == "__main__":
    main()
