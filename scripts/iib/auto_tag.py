from typing import List, Dict, Any, Optional
import re
import threading
from scripts.iib.db.datamodel import GlobalSetting, Tag, ImageTag, DataBase
from scripts.iib.logger import logger
from scripts.iib.parsers.model import ImageGenerationParams


class AutoTagMatcher:
    """自动打标签匹配器。

    单例只缓存规则列表，**不再保存任何数据库连接**：连接始终由调用方传入
    （DataBase.get_conn() 是线程私有的，后台 worker 线程和请求线程各自持有
    自己的连接，跨线程共享 conn 会触发 sqlite 的 same-thread 检查）。
    """

    _instance: Optional['AutoTagMatcher'] = None
    _lock = threading.Lock()

    def __init__(self, conn=None):
        self.rules = self.load_rules(self._resolve_conn(conn))

    @staticmethod
    def _resolve_conn(conn):
        return conn if conn is not None else DataBase.get_conn()

    @classmethod
    def get_instance(cls, conn=None) -> 'AutoTagMatcher':
        """获取全局单例实例（仅缓存规则；连接由 apply 的调用方提供）"""
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(conn)
            return cls._instance

    @classmethod
    def reload_rules(cls, conn=None) -> None:
        """重新加载规则"""
        conn = cls._resolve_conn(conn)
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls(conn)
            else:
                cls._instance.rules = cls._instance.load_rules(conn)

    def load_rules(self, conn) -> List[Dict[str, Any]]:
        try:
            setting = GlobalSetting.get_setting(conn, "auto_tag_rules")
            print("Loaded auto tag rules:", setting)
            if setting:
                return setting
        except Exception as e:
            logger.error(f"Error loading auto tag rules: {e}")
        return []

    def match(self, params: ImageGenerationParams, rule: Dict[str, Any]) -> bool:
        # params is ImageGenerationParams
        # rule structure: { "tag": "TagName", "filters": [...] }
        # filter structure: { "field": "pos_prompt", "operator": "contains", "value": "foo" }

        filters = rule.get("filters", [])
        if not filters:
            return False

        for filter in filters:
            field = filter.get("field")
            operator = filter.get("operator")
            value = filter.get("value")

            target_value = ""
            if field == "pos_prompt":
                target_value = ",".join(params.pos_prompt) if isinstance(params.pos_prompt, list) else str(params.pos_prompt)
            elif field == "neg_prompt":
                 # Assuming neg_prompt might be in meta or extra, but params usually has pos_prompt.
                 # Let's check where negative prompt is usually stored.
                 # In api.py: params = parse_generation_parameters(content)
                 # parse_generation_parameters returns dict with "meta", "pos_prompt".
                 # "meta" usually contains "Negative prompt".
                 target_value = params.meta.get("Negative prompt", "")
            else:
                # Try to find in meta
                target_value = params.meta.get(field, "")
                if not target_value and field in params.extra:
                     target_value = params.extra.get(field, "")

            target_value = str(target_value)

            if operator == "contains":
                if value.lower() not in target_value.lower():
                    return False
            elif operator == "equals":
                if value.lower() != target_value.lower():
                    return False
            elif operator == "regex":
                try:
                    if not re.search(value, target_value, re.IGNORECASE):
                        return False
                except:
                    return False
            # Add more operators if needed

        return True

    def apply(self, img_id: int, params: Any, conn=None):
        """对单张图应用自动标签规则。

        conn: 调用方（当前线程）的数据库连接；省略时使用当前线程的连接。
        """
        rules = self.rules  # 取快照，reload_rules 并发替换列表时也能安全遍历
        if not rules:
            return
        conn = self._resolve_conn(conn)

        for rule in rules:
            try:
                if self.match(params, rule):
                    tag_name = rule.get("tag")
                    if tag_name:
                        tag = Tag.get_or_create(conn, tag_name, "custom")
                        if tag:
                            ImageTag(img_id, tag.id).save_or_ignore(conn)
            except Exception as e:
                logger.error(f"Error applying auto tag rule {rule}: {e}")
