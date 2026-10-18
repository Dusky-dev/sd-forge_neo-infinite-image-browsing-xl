"""后台静默维护（silent maintenance）设置的持久化与规范化。

设置以 JSON 存于 ``global_setting`` 表，key 为 ``background_maintenance``：

.. code-block:: json

    {
      "index": false,
      "thumbnail": false,
      "thumbnailSize": 512,
      "thumbnailSince": null,
      "cpuLimit": 20,
      "bannerDismissed": false
    }

后端只做持久化，不依赖前端 store。所有读取路径都容忍缺失/损坏的数据，
一旦解析失败就回退到 :data:`DEFAULTS` 的副本。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, Optional

from scripts.iib.db.datamodel import GlobalSetting
from scripts.iib.logger import logger

SETTING_KEY = "background_maintenance"

DEFAULTS: Dict[str, Any] = {
    "index": False,
    "thumbnail": False,
    "thumbnailSize": 512,
    "thumbnailSince": None,
    "cpuLimit": 20,
    "bannerDismissed": False,
}

THUMBNAIL_SIZE_MIN = 256
THUMBNAIL_SIZE_MAX = 1024
THUMBNAIL_SIZE_STEP = 64
THUMBNAIL_SIZE_DEFAULT = 512

CPU_LIMIT_MIN = 5
CPU_LIMIT_MAX = 50
CPU_LIMIT_DEFAULT = 20


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _pick_bool(value: Any, default: bool) -> bool:
    """只接受真正的 bool；JSON 里的 0/1 也允许（部分旧前端会这么传）。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    return default


def _normalize_thumbnail_size(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return THUMBNAIL_SIZE_DEFAULT
    size = int(value)
    if not (THUMBNAIL_SIZE_MIN <= size <= THUMBNAIL_SIZE_MAX):
        return THUMBNAIL_SIZE_DEFAULT
    if (size - THUMBNAIL_SIZE_MIN) % THUMBNAIL_SIZE_STEP != 0:
        return THUMBNAIL_SIZE_DEFAULT
    return size


def _normalize_thumbnail_since(value: Any) -> Optional[str]:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return None
    return value


def _normalize_cpu_limit(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return CPU_LIMIT_DEFAULT
    cpu_limit = int(round(value))
    if cpu_limit < CPU_LIMIT_MIN or cpu_limit > CPU_LIMIT_MAX:
        return CPU_LIMIT_DEFAULT
    return cpu_limit


def normalize_settings(raw: Optional[dict]) -> dict:
    """把任意输入规范成完整、合法的设置对象（缺失补默认、未知字段丢弃）。"""
    src = raw if isinstance(raw, dict) else {}

    settings = {
        "index": _pick_bool(src.get("index"), DEFAULTS["index"]),
        "thumbnail": _pick_bool(src.get("thumbnail"), DEFAULTS["thumbnail"]),
        "thumbnailSize": _normalize_thumbnail_size(src.get("thumbnailSize")),
        "thumbnailSince": _normalize_thumbnail_since(src.get("thumbnailSince")),
        "cpuLimit": _normalize_cpu_limit(src.get("cpuLimit")),
        "bannerDismissed": _pick_bool(
            src.get("bannerDismissed"), DEFAULTS["bannerDismissed"]
        ),
    }

    # 缩略图预热从属于索引维护：总开关关闭时子开关必须为 false。
    if not settings["index"]:
        settings["thumbnail"] = False

    return settings


def load_settings(conn) -> dict:
    """从 DB 读取并规范化设置；缺失/损坏时返回默认值副本。"""
    try:
        raw = GlobalSetting.get_setting(conn, SETTING_KEY)
    except Exception as exc:  # json 损坏 / 表不存在 / 连接异常
        logger.warning("load background_maintenance settings failed: %s", exc)
        return dict(DEFAULTS)
    if raw is None:
        return dict(DEFAULTS)
    try:
        return normalize_settings(raw)
    except Exception as exc:
        logger.warning("normalize background_maintenance settings failed: %s", exc)
        return dict(DEFAULTS)


def save_settings(conn, val: dict) -> dict:
    """规范化并持久化设置，返回实际写入的对象。

    ``thumbnail`` 由 false 变 true 时补 ``thumbnailSince``（已有值则保留），
    这样 worker 只预热"开启之后新加入索引"的图片。
    """
    normalized = normalize_settings(val)

    previous = None
    try:
        previous = GlobalSetting.get_setting(conn, SETTING_KEY)
    except Exception:
        previous = None
    previous = previous if isinstance(previous, dict) else {}

    if normalized["thumbnailSince"] is None:
        # "已有的 thumbnailSince 保留"：false->true 时补 now，true->false 也保留历史值，
        # 避免用户来回切换开关时把"只预热开启后新图"的起点重置掉。
        previous_since = previous.get("thumbnailSince")
        if isinstance(previous_since, str) and previous_since:
            normalized["thumbnailSince"] = previous_since
        elif normalized["thumbnail"]:
            normalized["thumbnailSince"] = _now_iso()

    GlobalSetting.save_setting(
        conn, SETTING_KEY, json.dumps(normalized, ensure_ascii=False)
    )
    return normalized
