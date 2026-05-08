"""结构化输出解析工具，供各 Agent 使用。"""

from __future__ import annotations

import json
import re

TAG_START = "<!--PANWATCH_JSON-->"
TAG_END = "<!--/PANWATCH_JSON-->"

_ACTION_KEYS = {"action", "reason", "triggers", "risks", "confidence_score"}


def strip_tagged_json(content: str) -> str:
    """移除内容中的 PANWATCH_JSON 标签块，返回纯文本部分。"""
    if not content:
        return content
    idx = content.find(TAG_START)
    if idx < 0:
        return content
    return content[:idx].rstrip()


def try_extract_tagged_json(content: str) -> dict | None:
    """从内容中提取 PANWATCH_JSON 标签块并解析为 dict。"""
    if not content:
        return None
    start = content.find(TAG_START)
    if start < 0:
        return None
    end = content.find(TAG_END, start)
    raw = content[start + len(TAG_START): end if end > start else len(content)]
    raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception:
        return None


def try_parse_action_json(content: str) -> dict | None:
    """尝试从 AI 输出中解析 action JSON 对象（支持裸 JSON 和代码块）。"""
    if not content:
        return None

    # 先尝试标签块
    tagged = try_extract_tagged_json(content)
    if tagged:
        suggestions = tagged.get("suggestions")
        if isinstance(suggestions, list) and suggestions:
            return suggestions[0]
        return tagged

    # 尝试 ```json 代码块
    code_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL)
    if code_block:
        try:
            obj = json.loads(code_block.group(1))
            if _ACTION_KEYS & set(obj.keys()):
                return obj
        except Exception:
            pass

    # 尝试裸 JSON 对象
    brace = re.search(r"\{[^{}]*\}", content, re.DOTALL)
    if brace:
        try:
            obj = json.loads(brace.group(0))
            if _ACTION_KEYS & set(obj.keys()):
                return obj
        except Exception:
            pass

    return None
