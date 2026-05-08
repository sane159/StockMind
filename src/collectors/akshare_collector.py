"""数据采集器 - 基于腾讯股票 HTTP API（稳定可靠，无 SSL 问题）"""
import logging
from abc import ABC, abstractmethod
from datetime import datetime

import httpx

from src.core.cn_symbol import get_cn_prefix
from src.models.market import MarketCode, StockData, IndexData

logger = logging.getLogger(__name__)

# 腾讯股票行情 API（HTTP，GBK 编码）
TENCENT_QUOTE_URL = "http://qt.gtimg.cn/q="

# 预定义指数
CN_INDICES = [
    ("000001", "上证指数", "sh"),
    ("399001", "深证成指", "sz"),
    ("399006", "创业板指", "sz"),
]


def _tencent_symbol(symbol: str) -> str:
    """转换为腾讯 API 格式: sh600519 / sz000001 / bj430047

    规则：
    - 上交所（含 ETF/LOF/B 股 等）：5/6/900 开头 -> sh{symbol}
    - 深交所（主板/中小板/创业板/B 股/ETF 等）：0/1/2/3 开头 -> sz{symbol}
    - 北交所：920 开头 或 83/87/88 开头 -> bj{symbol}
    - 其他未知前缀，默认归为深市 sz
    """
    return get_cn_prefix(symbol) + symbol


def _parse_tencent_line(line: str) -> dict | None:
    """解析腾讯 API 单行响应"""
    if "=\"\"" in line or not line.strip():
        return None
    try:
        _, value = line.split('="', 1)
        value = value.rstrip('";')
        parts = value.split("~")
        if len(parts) < 35:
            return None

        # 解析成交额: parts[35] 格式为 "price/vol/turnover"
        turnover = 0.0
        if "/" in str(parts[35]):
            turnover_parts = parts[35].split("/")
            if len(turnover_parts) >= 3:
                try:
                    turnover = float(turnover_parts[2])
                except (ValueError, IndexError):
                    pass

        def _to_float(value: str | None) -> float | None:
            if value is None:
                return None
            v = str(value).strip()
            if not v:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        symbol = parts[2]

        # 腾讯常见字段：
        # - 38=换手率(%)
        # - 39=市盈率(常见为静态/TTM，视市场而定)
        # - 44=流通市值
        # - 45=总市值
        turnover_rate = None
        pe_ratio = None
        if len(parts) > 39:
            turnover_rate = _to_float(parts[38])
            pe_ratio = _to_float(parts[39])

        circulating_market_value = None
        total_market_value = None
        if len(parts) > 45:
            circulating_market_value = _to_float(parts[44])
            total_market_value = _to_float(parts[45])

        return {
            "name": parts[1],
            "symbol": symbol,
            "current_price": float(parts[3] or 0),
            "prev_close": float(parts[4] or 0),
            "open_price": float(parts[5] or 0),
            "volume": float(parts[6] or 0),
            "change_amount": float(parts[31] or 0),
            "change_pct": float(parts[32] or 0),
            "high_price": float(parts[33] or 0),
            "low_price": float(parts[34] or 0),
            "turnover": turnover,
            "turnover_rate": turnover_rate,
            "pe_ratio": pe_ratio,
            "circulating_market_value": circulating_market_value,
            "total_market_value": total_market_value,
        }
    except (ValueError, IndexError) as e:
        logger.debug(f"解析腾讯行情失败: {e}")
        return None


def _fetch_tencent_quotes(symbols: list[str]) -> list[dict]:
    """批量获取腾讯实时行情"""
    if not symbols:
        return []
    url = TENCENT_QUOTE_URL + ",".join(symbols)
    with httpx.Client() as client:
        resp = client.get(url, timeout=10)
        content = resp.content.decode("gbk", errors="ignore")

    results = []
    for line in content.strip().split(";"):
        parsed = _parse_tencent_line(line)
        if parsed and parsed["current_price"] > 0:
            results.append(parsed)
    return results


class BaseCollector(ABC):
    """数据采集器抽象基类"""

    @abstractmethod
    async def get_index_data(self) -> list[IndexData]:
        ...

    @abstractmethod
    async def get_stock_data(self, symbols: list[str]) -> list[StockData]:
        ...


class AkshareCollector(BaseCollector):
    """基于腾讯 HTTP API 的数据采集器"""

    async def get_index_data(self) -> list[IndexData]:
        return self._get_cn_index()

    async def get_stock_data(self, symbols: list[str]) -> list[StockData]:
        return self._get_cn_stocks(symbols)

    def _get_cn_index(self) -> list[IndexData]:
        tencent_symbols = [f"{prefix}{symbol}" for symbol, _, prefix in CN_INDICES]
        try:
            items = _fetch_tencent_quotes(tencent_symbols)
        except Exception as e:
            logger.error(f"获取 A 股指数失败: {e}")
            return []

        return [
            IndexData(
                symbol=item["symbol"],
                name=item["name"],
                market=MarketCode.CN,
                current_price=item["current_price"],
                change_pct=item["change_pct"],
                change_amount=item["change_amount"],
                volume=item["volume"],
                turnover=item["turnover"],
                timestamp=datetime.now(),
            )
            for item in items
        ]

    def _get_cn_stocks(self, symbols: list[str]) -> list[StockData]:
        tencent_symbols = [_tencent_symbol(s) for s in symbols]
        try:
            items = _fetch_tencent_quotes(tencent_symbols)
        except Exception as e:
            logger.error(f"获取 A 股行情失败: {e}")
            return []

        return [
            StockData(
                symbol=item["symbol"],
                name=item["name"],
                market=MarketCode.CN,
                current_price=item["current_price"],
                change_pct=item["change_pct"],
                change_amount=item["change_amount"],
                volume=item["volume"],
                turnover=item["turnover"],
                open_price=item["open_price"],
                high_price=item["high_price"],
                low_price=item["low_price"],
                prev_close=item["prev_close"],
                timestamp=datetime.now(),
            )
            for item in items
        ]

