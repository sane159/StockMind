"""结构化输出解析工具 - 从 src.core.structured_output 重新导出，保持向后兼容。"""

from src.core.structured_output import (
    TAG_START,
    TAG_END,
    strip_tagged_json,
    try_extract_tagged_json,
    try_parse_action_json,
)

__all__ = [
    "TAG_START",
    "TAG_END",
    "strip_tagged_json",
    "try_extract_tagged_json",
    "try_parse_action_json",
]
