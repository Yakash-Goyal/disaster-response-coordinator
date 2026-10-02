"""LLM access for the agent layer.

The agents are written against a small `complete_json()` interface rather than
a specific vendor SDK. Two providers implement it:

* `AnthropicProvider` — calls the Messages API over HTTP.
* `NullProvider`      — returns nothing, which makes every agent fall through
                        to its deterministic heuristic path.

Selection is automatic: if no API key is configured the system runs entirely
offline. That matters for a demo — nothing about the platform stops working
when the network or the key is unavailable, it just degrades to rule-based
reasoning and says so in the decision log.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import httpx

from ..config import settings

log = logging.getLogger("drc.llm")

ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


class LLMUnavailable(Exception):
    pass


def _extract_json(raw: str) -> dict[str, Any]:
    """Models sometimes wrap JSON in prose or fences. Recover the object."""
    text = raw.strip()
    text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.MULTILINE).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start, depth = None, 0
    for i, ch in enumerate(text):
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start is not None:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    start = None
    raise LLMUnavailable("model did not return parsable JSON")


class BaseProvider:
    name = "none"
    available = False

    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        raise LLMUnavailable("no provider")

    async def complete_text(self, system: str, user: str, max_tokens: int = 200) -> str:
        raise LLMUnavailable("no provider")


class NullProvider(BaseProvider):
    name = "heuristic"
    available = False


class AnthropicProvider(BaseProvider):
    name = "anthropic"
    available = True

    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key
        self.model = model
        self._client: httpx.AsyncClient | None = None
        self._fail_count = 0

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=settings.LLM_TIMEOUT)
        return self._client

    async def _call(self, system: str, user: str, max_tokens: int) -> str:
        if self._fail_count >= 3:
            # Circuit breaker: stop hammering a broken endpoint mid-incident.
            raise LLMUnavailable("provider disabled after repeated failures")
        client = await self._http()
        body = {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        try:
            resp = await client.post(ANTHROPIC_URL, json=body, headers=headers)
            resp.raise_for_status()
        except Exception as exc:
            self._fail_count += 1
            log.warning("LLM call failed (%s/3): %s", self._fail_count, exc)
            raise LLMUnavailable(str(exc)) from exc
        self._fail_count = 0
        data = resp.json()
        return "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")

    async def complete_json(self, system: str, user: str) -> dict[str, Any]:
        raw = await self._call(system, user, settings.LLM_MAX_TOKENS)
        return _extract_json(raw)

    async def complete_text(self, system: str, user: str, max_tokens: int = 200) -> str:
        return (await self._call(system, user, max_tokens)).strip()

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


_provider: BaseProvider | None = None


def get_provider() -> BaseProvider:
    global _provider
    if _provider is not None:
        return _provider
    mode = settings.LLM_PROVIDER.lower()
    if mode == "heuristic" or (mode == "auto" and not settings.ANTHROPIC_API_KEY):
        _provider = NullProvider()
    elif settings.ANTHROPIC_API_KEY:
        _provider = AnthropicProvider(settings.ANTHROPIC_API_KEY, settings.LLM_MODEL)
    else:
        log.warning("LLM_PROVIDER=%s but no ANTHROPIC_API_KEY set; using heuristics", mode)
        _provider = NullProvider()
    log.info("LLM provider: %s", _provider.name)
    return _provider


async def try_json(system: str, user: str) -> dict[str, Any] | None:
    """Best-effort structured completion. Returns None instead of raising so
    callers can drop cleanly into their heuristic path."""
    provider = get_provider()
    if not provider.available:
        return None
    try:
        return await asyncio.wait_for(provider.complete_json(system, user), timeout=settings.LLM_TIMEOUT + 2)
    except (LLMUnavailable, asyncio.TimeoutError, Exception) as exc:  # noqa: BLE001
        log.info("falling back to heuristics: %s", exc)
        return None


async def try_text(system: str, user: str, max_tokens: int = 200) -> str | None:
    provider = get_provider()
    if not provider.available:
        return None
    try:
        return await asyncio.wait_for(
            provider.complete_text(system, user, max_tokens), timeout=settings.LLM_TIMEOUT + 2
        )
    except Exception:  # noqa: BLE001
        return None


async def shutdown_provider() -> None:
    global _provider
    if isinstance(_provider, AnthropicProvider):
        await _provider.aclose()
    _provider = None
