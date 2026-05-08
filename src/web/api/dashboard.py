"""首页聚合 API。"""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.config import Settings
from src.web.database import get_db
from src.web.models import (
    AnalysisHistory,
    LogEntry,
    NewsTopicSnapshot,
    Stock,
)

router = APIRouter()


def _format_datetime(dt) -> str:
    if not dt:
        return ""
    tz_name = Settings().app_timezone or "UTC"
    try:
        tzinfo = ZoneInfo(tz_name)
    except Exception:
        tzinfo = timezone.utc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tzinfo).isoformat(timespec="seconds")


def _summarize_topics(raw_topics) -> list[dict]:
    out: list[dict] = []
    topics = raw_topics if isinstance(raw_topics, list) else []
    for item in topics:
        if isinstance(item, dict):
            name = str(item.get("topic") or item.get("name") or "").strip()
            if not name:
                continue
            out.append(
                {
                    "name": name,
                    "score": float(item.get("score") or 0.0),
                    "sentiment": str(item.get("sentiment") or "neutral"),
                }
            )
        elif isinstance(item, str):
            text = item.strip()
            if text:
                out.append({"name": text, "score": 0.0, "sentiment": "neutral"})
        if len(out) >= 8:
            break
    return out


def _load_latest_insights(db: Session) -> list[dict]:
    out = []
    agents = (
        ("premarket_outlook", "盘前分析"),
        ("daily_report", "收盘复盘"),
        ("news_digest", "新闻速递"),
    )
    for agent_name, label in agents:
        row = (
            db.query(AnalysisHistory)
            .filter(AnalysisHistory.agent_name == agent_name)
            .order_by(
                AnalysisHistory.analysis_date.desc(),
                AnalysisHistory.updated_at.desc(),
                AnalysisHistory.id.desc(),
            )
            .first()
        )
        if not row:
            continue
        out.append(
            {
                "id": int(row.id),
                "agent_name": agent_name,
                "agent_label": label,
                "analysis_date": row.analysis_date or "",
                "title": row.title or "",
                "updated_at": _format_datetime(row.updated_at),
            }
        )
    return out


@router.get("/overview")
def get_dashboard_overview(db: Session = Depends(get_db)):
    watchlist_count = int((db.query(func.count(Stock.id)).scalar() or 0))

    # 最近 24h 错误数
    from datetime import timedelta
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    error_24h = int(
        db.query(func.count(LogEntry.id))
        .filter(LogEntry.level == "ERROR", LogEntry.created_at >= cutoff)
        .scalar()
        or 0
    )

    # 最新新闻话题
    latest_topic = (
        db.query(NewsTopicSnapshot)
        .order_by(NewsTopicSnapshot.snapshot_date.desc(), NewsTopicSnapshot.id.desc())
        .first()
    )
    hot_topics = _summarize_topics(latest_topic.topics if latest_topic else [])

    return {
        "kpis": {
            "watchlist_count": watchlist_count,
            "errors_24h": error_24h,
        },
        "market_pulse": {
            "hot_topics": hot_topics,
        },
        "insights": _load_latest_insights(db),
    }
