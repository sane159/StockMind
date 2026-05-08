"""SignalPack: 单只股票的结构化数据包，供 Agent 使用。"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from src.collectors.akshare_collector import AkshareCollector
from src.collectors.capital_flow_collector import CapitalFlowCollector
from src.collectors.events_collector import EastMoneyEventsCollector
from src.collectors.kline_collector import KlineCollector
from src.collectors.news_collector import NewsCollector, NewsItem
from src.models.market import MarketCode, StockData

logger = logging.getLogger(__name__)


@dataclass
class NewsBundle:
    items: list[dict] = field(default_factory=list)


@dataclass
class EventsBundle:
    items: list[dict] = field(default_factory=list)


@dataclass
class PositionBundle:
    aggregated: dict | None = None


@dataclass
class SignalPack:
    symbol: str
    market: MarketCode
    name: str
    quote: StockData | None = None
    technical: dict | None = None
    capital_flow: dict | None = None
    news: NewsBundle = field(default_factory=NewsBundle)
    events: EventsBundle = field(default_factory=EventsBundle)
    position: PositionBundle = field(default_factory=PositionBundle)


class SignalPackBuilder:
    """并发采集各类数据，组装成 SignalPack。"""

    async def build_for_symbols(
        self,
        symbols: list[tuple[str, MarketCode, str]],
        *,
        include_news: bool = True,
        news_hours: int = 48,
        portfolio=None,
        include_technical: bool = True,
        include_capital_flow: bool = True,
        include_events: bool = True,
        events_days: int = 7,
    ) -> dict[str, SignalPack]:
        tasks = [
            self._build_one(
                symbol=sym,
                market=mkt,
                name=name,
                include_news=include_news,
                news_hours=news_hours,
                portfolio=portfolio,
                include_technical=include_technical,
                include_capital_flow=include_capital_flow,
                include_events=include_events,
                events_days=events_days,
            )
            for sym, mkt, name in symbols
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        packs: dict[str, SignalPack] = {}
        for (sym, _, _), result in zip(symbols, results):
            if isinstance(result, Exception):
                logger.warning("SignalPack 采集失败 %s: %s", sym, result)
                packs[sym] = SignalPack(symbol=sym, market=MarketCode.CN, name=sym)
            else:
                packs[sym] = result
        return packs

    async def _build_one(
        self,
        *,
        symbol: str,
        market: MarketCode,
        name: str,
        include_news: bool,
        news_hours: int,
        portfolio,
        include_technical: bool,
        include_capital_flow: bool,
        include_events: bool,
        events_days: int,
    ) -> SignalPack:
        pack = SignalPack(symbol=symbol, market=market, name=name)

        # 行情
        try:
            collector = AkshareCollector()
            quotes = await collector.get_quotes([symbol])
            pack.quote = quotes[0] if quotes else None
        except Exception as e:
            logger.warning("行情采集失败 %s: %s", symbol, e)

        # 技术指标（K线摘要）
        if include_technical:
            try:
                kline_collector = KlineCollector(market)
                summary = kline_collector.get_kline_summary(symbol)
                pack.technical = summary if summary else {"error": "无技术指标数据"}
            except Exception as e:
                logger.warning("技术指标采集失败 %s: %s", symbol, e)
                pack.technical = {"error": str(e)}

        # 资金流向（仅 A 股）
        if include_capital_flow and market == MarketCode.CN:
            try:
                flow_collector = CapitalFlowCollector()
                flow = flow_collector.get_capital_flow(symbol)
                if flow:
                    pack.capital_flow = {
                        "status": True,
                        "main_net_inflow": flow.main_net_inflow,
                        "main_net_inflow_pct": flow.main_net_inflow_pct,
                        "super_net_inflow": flow.super_net_inflow,
                        "big_net_inflow": flow.big_net_inflow,
                        "main_net_5d": flow.main_net_5d,
                    }
                else:
                    pack.capital_flow = {"error": "无资金流向数据"}
            except Exception as e:
                logger.warning("资金流向采集失败 %s: %s", symbol, e)
                pack.capital_flow = {"error": str(e)}

        # 新闻
        if include_news:
            try:
                news_collector = NewsCollector()
                cutoff = datetime.now() - timedelta(hours=news_hours)
                raw_news = await news_collector.get_news(symbol, limit=20)
                items = []
                for n in raw_news:
                    pub = n.publish_time if hasattr(n, "publish_time") else None
                    if pub and pub < cutoff:
                        continue
                    items.append({
                        "title": n.title,
                        "time": pub.strftime("%Y-%m-%d %H:%M") if pub else "",
                        "content": getattr(n, "content", "") or "",
                        "url": getattr(n, "url", "") or "",
                        "source": getattr(n, "source", "") or "",
                        "symbols": getattr(n, "symbols", []) or [],
                        "importance": getattr(n, "importance", 0) or 0,
                    })
                pack.news = NewsBundle(items=items)
            except Exception as e:
                logger.warning("新闻采集失败 %s: %s", symbol, e)

        # 事件
        if include_events:
            try:
                events_collector = EastMoneyEventsCollector()
                raw_events = events_collector.get_events(
                    symbol, days=events_days
                )
                items = []
                for e in raw_events or []:
                    items.append({
                        "title": e.title,
                        "event_type": e.event_type,
                        "time": e.publish_time.strftime("%Y-%m-%d") if e.publish_time else "",
                        "importance": e.importance,
                        "url": e.url or "",
                    })
                pack.events = EventsBundle(items=items)
            except Exception as e:
                logger.warning("事件采集失败 %s: %s", symbol, e)

        # 持仓
        if portfolio:
            try:
                agg = portfolio.get_aggregated_position(symbol)
                pack.position = PositionBundle(aggregated=agg)
            except Exception:
                pass

        return pack
