# StockMind

**AI 驱动的 A 股智能分析助手** — 自托管部署，多 Agent 协作，让 AI 帮你盯盘

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 项目简介

StockMind 是一个面向个人投资者的私有化 AI 股票分析平台。通过接入任意 OpenAI 兼容的大语言模型（DeepSeek、智谱、Ollama 等），结合实时行情、技术指标、资金流向、财经新闻等多维数据，由多个专业 Agent 自动完成盘前研判、盘中监控、盘后复盘全流程，并在关键时刻通过飞书机器人推送提醒。

所有数据本地存储，不依赖任何第三方云服务。

## 核心功能

### 多 Agent 智能分析

StockMind 内置 4 个专业 Agent，按交易时间自动调度：

| Agent | 触发时机 | 功能描述 |
|-------|---------|---------|
| **盘前分析** (PremarketOutlook) | 每日开盘前 | 综合隔夜新闻、技术形态、资金动向，生成今日操作策略 |
| **盘中监测** (IntradayMonitor) | 交易时段每 30 分钟 | 实时监控 RSI/KDJ/MACD 共振信号，异动时立即推送 |
| **盘后日报** (DailyReport) | 每日收盘后 | 复盘当日走势，分析量价关系，规划次日操作方向 |
| **新闻速递** (NewsDigest) | 定时采集 | 抓取财经新闻，AI 筛选与自选股相关的重要资讯 |

每个 Agent 均支持独立配置：指定 AI 模型、调度时间、通知渠道，也可手动触发。

### 技术分析引擎

Agent 分析时自动计算并注入以下技术指标：

- **趋势**：MA5/10/20/60 多空排列、MACD 金叉死叉、布林带突破
- **动量**：RSI 超买超卖区间、KDJ 钝化与背离识别
- **量价**：量比异动、缩量回调、放量突破判断
- **形态**：锤子线、吞没形态、十字星等经典 K 线形态
- **支撑压力**：基于近期高低点自动计算多级支撑位和压力位

### AI 对话助手

每只股票均可打开 AI 对话面板，助手自动注入该股实时行情、技术摘要、历史分析记录作为上下文，支持多轮对话，可直接提问"现在适合建仓吗"、"近期走势如何"等问题。

### 价格提醒

灵活的条件触发系统，支持：

- 条件类型：价格、涨跌幅、成交额、量比
- 逻辑组合：AND / OR 多条件组合
- 触发控制：冷却时间、日触发上限、重复触发模式
- 时段设置：仅交易时段或全天生效
- 通知渠道：可为每条规则单独指定推送渠道

### 飞书通知

通过飞书机器人 Webhook 推送 Agent 分析报告和价格提醒，可为每条提醒规则单独指定是否推送。

### 数据源管理

内置多路数据源（腾讯行情、东方财富、AKShare），支持在界面中管理、测试、启用/禁用，行情获取失败时自动降级切换。

## 快速开始

**环境要求**：Python 3.10+ / Node.js 18+ / conda 或 venv

```bash
# 后端
conda create -n stockmind python=3.11 -y
conda activate stockmind
pip install -r requirements.txt
python server.py

# 前端（新终端）
cd frontend && npm install && npm run dev
```

访问 `http://localhost:5173`，首次使用设置账号密码即可。

<details>
<summary>首次配置步骤</summary>

1. 访问 Web 界面，设置登录账号密码
2. **设置 → AI 服务商**：添加 OpenAI 兼容 API（支持 OpenAI / DeepSeek / 智谱 / Ollama 等）
3. **设置 → 通知渠道**：配置飞书机器人 Webhook（可选）
4. **自选股 → 添加股票**：搜索并添加 A 股自选股
5. **Agent → 启用**：为自选股开启对应 Agent，配置调度时间

</details>

<details>
<summary>环境变量</summary>

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `AUTH_USERNAME` | 预设登录用户名 | 首次访问时设置 |
| `AUTH_PASSWORD` | 预设登录密码 | 首次访问时设置 |
| `JWT_SECRET` | JWT 签名密钥 | 自动生成 |
| `DATA_DIR` | 数据存储目录 | `./data` |
| `TZ` | 应用时区（影响 Agent 调度时间与时间展示） | `Asia/Shanghai` |

</details>

## License

[MIT](LICENSE)
