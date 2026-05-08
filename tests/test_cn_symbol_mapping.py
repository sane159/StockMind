import unittest

from src.collectors.akshare_collector import _tencent_symbol as ak_tencent_symbol
from src.collectors.capital_flow_collector import _get_eastmoney_secid
from src.collectors.kline_collector import _tencent_symbol as kline_tencent_symbol
from src.collectors.news_collector import XueqiuNewsCollector
from src.collectors.screenshot_collector import ScreenshotCollector
from src.core.cn_symbol import get_cn_exchange, get_cn_prefix, is_cn_sh
from src.models.market import MarketCode


class TestCnSymbolMapping(unittest.TestCase):
    def test_cn_exchange_core(self):
        self.assertEqual(get_cn_exchange("000738"), "SZ")
        self.assertEqual(get_cn_exchange("600519"), "SH")
        self.assertEqual(get_cn_exchange("300750"), "SZ")
        self.assertEqual(get_cn_exchange("510300"), "SH")
        self.assertEqual(get_cn_exchange("900901"), "SH")
        self.assertEqual(get_cn_exchange("920001"), "BJ")

    def test_cn_prefix_core(self):
        self.assertEqual(get_cn_prefix("000738"), "sz")
        self.assertEqual(get_cn_prefix("600519"), "sh")
        self.assertEqual(get_cn_prefix("920001"), "bj")
        self.assertEqual(get_cn_prefix("000738", upper=True), "SZ")
        self.assertTrue(is_cn_sh("600519"))
        self.assertFalse(is_cn_sh("000738"))

    def test_akshare_tencent_symbol_uses_unified_mapping(self):
        self.assertEqual(ak_tencent_symbol("000738", MarketCode.CN), "sz000738")
        self.assertEqual(ak_tencent_symbol("600519", MarketCode.CN), "sh600519")
        self.assertEqual(ak_tencent_symbol("920001", MarketCode.CN), "bj920001")

    def test_kline_tencent_symbol_uses_unified_mapping(self):
        self.assertEqual(kline_tencent_symbol("000738", MarketCode.CN), "sz000738")
        self.assertEqual(kline_tencent_symbol("600519", MarketCode.CN), "sh600519")
        self.assertEqual(kline_tencent_symbol("920001", MarketCode.CN), "bj920001")

    def test_capital_flow_secid(self):
        self.assertEqual(_get_eastmoney_secid("000738", MarketCode.CN), "0.000738")
        self.assertEqual(_get_eastmoney_secid("600519", MarketCode.CN), "1.600519")

    def test_xueqiu_news_symbol_id(self):
        collector = XueqiuNewsCollector()
        self.assertEqual(collector._get_symbol_id("000738"), "SZ000738")
        self.assertEqual(collector._get_symbol_id("600519"), "SH600519")
        self.assertEqual(collector._get_symbol_id("510300"), "SH510300")

    def test_screenshot_urls(self):
        collector = ScreenshotCollector()
        self.assertEqual(
            collector._get_sina_url("000738", "CN"),
            "https://finance.sina.com.cn/realstock/company/sz000738/nc.shtml",
        )
        self.assertEqual(
            collector._get_xueqiu_url("000738", "CN"),
            "https://xueqiu.com/S/SZ000738",
        )
        self.assertEqual(
            collector._get_eastmoney_url("600519", "CN"),
            "https://quote.eastmoney.com/sh600519.html",
        )


if __name__ == "__main__":
    unittest.main()
