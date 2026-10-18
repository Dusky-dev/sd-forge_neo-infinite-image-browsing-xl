"""缩略图缓存路径计算与生成。

从 ``scripts/iib/api.py`` 迁出的 `_ensure_thumbnail`（行为保持一致），
额外提供后台预热需要的 ``cache_path_for`` / ``is_cache_candidate``。

缓存目录结构与 ``GET {api_base}/image-thumbnail`` 完全一致::

    <IIB_CACHE_DIR 或 临时目录>/iib_cache/<md5(path + t)>/<size>x<size>.webp
"""

from __future__ import annotations

import hashlib
import os
import threading

from fastapi import HTTPException
from PIL import Image

from scripts.iib.tool import get_cache_dir, is_image_file

# 与 /image-thumbnail 一致：小于该体积的源图直接返回原图，不需要缓存。
MIN_SOURCE_BYTES = 64 * 1024

# 缩略图生成并发保护：全局槽位限制同时解码的图片数，条带锁避免同一缓存 key 重复生成。
_THUMBNAIL_GENERATION_SLOTS = threading.BoundedSemaphore(
    max(2, min(4, os.cpu_count() or 2))
)
_THUMBNAIL_LOCKS = tuple(threading.Lock() for _ in range(64))


def thumb_cache_root() -> str:
    """返回 iib_cache 根目录（可能与用户手动浏览产生的缩略图共用）。"""
    cache_base_dir = get_cache_dir()
    if not cache_base_dir:
        return ""
    return os.path.join(cache_base_dir, "iib_cache")


def ensure_thumbnail(path: str, cache_path: str, width: int, height: int):
    """确保 ``cache_path`` 处存在缩略图，不存在则从 ``path`` 生成。

    行为与迁移前 api.py 中的 ``_ensure_thumbnail`` 完全一致：draft 解码加速、
    WEBP quality=80/method=1、先写临时文件再 ``os.replace`` 原子替换；
    源图损坏或已被删除时抛 ``HTTPException(404)`` 让前端回退原图。
    """
    if os.path.exists(cache_path):
        return

    lock_idx = int(hashlib.md5(cache_path.encode("utf-8")).hexdigest()[:8], 16) % len(
        _THUMBNAIL_LOCKS
    )
    # Wait for a generation slot *before* taking the per-key lock, so threads
    # waiting for a slot do not hold a stripe lock (which would needlessly
    # serialize unrelated cache keys that hash to the same stripe).
    with _THUMBNAIL_GENERATION_SLOTS:
        with _THUMBNAIL_LOCKS[lock_idx]:
            if os.path.exists(cache_path):
                return

            os.makedirs(os.path.dirname(cache_path), exist_ok=True)
            temp_path = f"{cache_path}.{threading.get_ident()}.tmp"
            try:
                with Image.open(path) as img:
                    # JPEG decoders can downsample during decode, which saves substantial
                    # CPU and memory for large source images.
                    img.draft("RGB", (width, height))
                    img.thumbnail((width, height))
                    img.save(temp_path, "WEBP", quality=80, method=1)
                os.replace(temp_path, cache_path)
            except Exception:
                # Deleted or broken source images used to surface as opaque 500s,
                # hammered on every retry; report them as 404 so the client can
                # fall back to the raw file instead.
                raise HTTPException(status_code=404, detail="Failed to generate thumbnail")
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)


def cache_path_for(path: str, date_str: str, size) -> str:
    """计算缩略图缓存文件路径，与 /image-thumbnail 的规则一致。

    Args:
        path: 图片绝对路径（worker 里应传 DB 中的 image.path，即 normpath 后的路径）。
        date_str: 图片修改时间字符串（image.date / ``get_modified_date``）。
        size: 缩略图边长（int），或 ``"WxH"`` 形式的字符串（兼容旧接口）。

    Returns:
        缓存文件绝对路径；未配置缓存目录时返回空字符串。
    """
    cache_root = thumb_cache_root()
    if not cache_root:
        return ""

    if isinstance(size, str):
        size_str = size.strip().lower()
        if "x" not in size_str:
            try:
                size_str = f"{int(size_str)}x{int(size_str)}"
            except ValueError:
                size_str = "512x512"
    else:
        try:
            side = int(size)
        except (TypeError, ValueError):
            side = 512
        size_str = f"{side}x{side}"

    hash_dir = hashlib.md5((path + (date_str or "")).encode("utf-8")).hexdigest()
    return os.path.join(cache_root, hash_dir, f"{size_str}.webp")


def is_cache_candidate(path: str) -> bool:
    """后台预热候选过滤：图片类型、源文件 >= 64KB、不在 node_modules 下。"""
    if not path:
        return False
    if "node_modules" in path.replace("\\", "/").split("/"):
        return False
    if not is_image_file(path):
        return False
    try:
        return os.path.getsize(path) >= MIN_SOURCE_BYTES
    except OSError:
        return False
