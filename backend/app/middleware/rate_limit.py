"""Simple in-memory sliding-window rate limit (single uvicorn process)."""

from __future__ import annotations

import ipaddress
import time
from collections import defaultdict, deque
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Paths that accept heavy / abuse-prone POST bodies.
LIMITED_PATHS = frozenset(
    {
        "/api/analyze",
        "/api/analyze/jobs",
        "/api/ratios/parse",
        "/api/ratios/compute",
        "/api/ratios",
        "/api/ratios/reset",
        "/api/tables",
        "/api/tables/reset",
    }
)
LIMITED_PREFIXES = ("/api/ratios/history/", "/api/tables/history/")


def _valid_ip(value: str | None) -> str | None:
    if not value:
        return None
    candidate = value.strip()
    if not candidate:
        return None
    try:
        ipaddress.ip_address(candidate)
    except ValueError:
        return None
    return candidate


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Limit POST requests per client IP on selected API paths."""

    def __init__(
        self,
        app,
        *,
        max_requests: int = 10,
        window_seconds: float = 60.0,
        paths: frozenset[str] = LIMITED_PATHS,
    ) -> None:
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.paths = paths
        self.prefixes = LIMITED_PREFIXES
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_ip(self, request: Request) -> str:
        # Prefer Cloudflare's connecting IP when traffic arrived via CF edge.
        # Do NOT trust client-supplied X-Forwarded-For (spoofable).
        cf_ip = _valid_ip(request.headers.get("cf-connecting-ip"))
        if cf_ip:
            return cf_ip
        # Optional X-Real-IP only when set by our Caddy to CF-Connecting-IP.
        real_ip = _valid_ip(request.headers.get("x-real-ip"))
        if real_ip:
            return real_ip
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        limited = path in self.paths or any(path.startswith(prefix) for prefix in self.prefixes)
        if request.method in {"POST", "PUT", "DELETE"} and limited:
            ip = self._client_ip(request)
            now = time.monotonic()
            window = self._hits[ip]
            cutoff = now - self.window_seconds
            while window and window[0] < cutoff:
                window.popleft()
            if len(window) >= self.max_requests:
                retry = max(1, int(self.window_seconds - (now - window[0])))
                return JSONResponse(
                    status_code=429,
                    content={
                        "detail": "Te veel verzoeken. Probeer later opnieuw.",
                    },
                    headers={"Retry-After": str(retry)},
                )
            window.append(now)

        return await call_next(request)
