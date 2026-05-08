import logging
import asyncio
import httpx

logger = logging.getLogger(__name__)

CHANNEL_TYPES = {
    "lark": {
        "label": "飞书机器人",
        "fields": ["webhook_token"],
    },
}

_APPRISE_TYPES: set = set()
_CUSTOM_IMPL_TYPES = {"lark"}
_MARKDOWN_CHANNELS = {"lark"}
_PLAIN_TEXT_CHANNELS: set = set()


def build_apprise_url(channel_type: str, config: dict) -> str | None:
    raise ValueError(f"不支持的渠道类型: {channel_type}")


class NotifierManager:
    """通知管理器：仅支持飞书"""

    def __init__(self, policy=None):
        self._custom_channels: list[tuple[str, dict]] = []
        self._channel_count = 0
        self.policy = policy

    def add_channel(self, channel_type: str, config: dict):
        if channel_type not in CHANNEL_TYPES:
            logger.error(f"不支持的通知渠道类型: {channel_type}")
            return
        self._custom_channels.append((channel_type, config))
        self._channel_count += 1
        logger.info(f"注册通知渠道: {channel_type}")

    async def notify(self, title: str, content: str, images: list[str] | None = None):
        await self.notify_with_result(title, content, images)

    async def notify_with_result(
        self,
        title: str,
        content: str,
        images: list[str] | None = None,
        *,
        bypass_quiet_hours: bool = False,
    ) -> dict:
        if self._channel_count == 0:
            logger.warning("没有可用的通知渠道")
            return {"success": False, "error": "没有可用的通知渠道"}

        try:
            if not bypass_quiet_hours and getattr(self, "policy", None):
                if self.policy.is_quiet_now():
                    logger.info("当前处于通知静默时段，跳过发送")
                    return {"success": False, "skipped": "quiet_hours"}
        except Exception:
            pass

        retry_attempts = 0
        backoff = 0.0
        try:
            if getattr(self, "policy", None):
                retry_attempts = max(0, int(self.policy.retry_attempts))
                backoff = float(self.policy.retry_backoff_seconds or 0.0)
        except Exception:
            pass

        async def _sleep_retry(i: int):
            if backoff > 0:
                await asyncio.sleep(backoff * (2 ** max(0, i - 1)))

        errors = []
        for ch_type, config in self._custom_channels:
            ch_ok = False
            last_err = ""
            for attempt in range(0, retry_attempts + 1):
                try:
                    await self._send_lark(config, title, content)
                    ch_ok = True
                    break
                except Exception as e:
                    last_err = f"{ch_type} 发送失败: {e}"
                    logger.error(last_err)
                if attempt < retry_attempts:
                    await _sleep_retry(attempt + 1)
            if not ch_ok:
                errors.append(last_err or f"{ch_type} 发送失败")

        if errors:
            return {"success": False, "error": "; ".join(errors)}
        return {"success": True}

    async def _send_lark(self, config: dict, title: str, content: str):
        """飞书机器人 Webhook"""
        webhook_token = config.get("webhook_token", "")
        if not webhook_token:
            raise ValueError("飞书需要 webhook_token")

        url = f"https://open.feishu.cn/open-apis/bot/v2/hook/{webhook_token}"
        text = f"{title}\n\n{content}" if title else content
        payload = {
            "msg_type": "text",
            "content": {"text": text},
        }

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()
            if data.get("code") != 0:
                raise RuntimeError(f"飞书发送失败: {data.get('msg')}")
            logger.info(f"飞书通知发送成功: {title}")
