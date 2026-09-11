"""Tests for rate-limit client IP selection (anti-spoofing)."""

from __future__ import annotations

from starlette.requests import Request

from app.middleware.rate_limit import RateLimitMiddleware


def _request(*, headers: dict[str, str] | None = None, client_host: str | None = "203.0.113.10") -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/analyze",
        "raw_path": b"/api/analyze",
        "query_string": b"",
        "headers": [
            (k.lower().encode("latin-1"), v.encode("latin-1"))
            for k, v in (headers or {}).items()
        ],
        "client": (client_host, 12345) if client_host else None,
        "server": ("testserver", 80),
    }
    return Request(scope)


def test_ignores_spoofed_x_forwarded_for() -> None:
    mw = RateLimitMiddleware(app=lambda: None)
    req = _request(
        headers={"X-Forwarded-For": "198.51.100.50"},
        client_host="10.0.0.2",
    )
    assert mw._client_ip(req) == "10.0.0.2"


def test_prefers_cf_connecting_ip() -> None:
    mw = RateLimitMiddleware(app=lambda: None)
    req = _request(
        headers={
            "CF-Connecting-IP": "198.51.100.77",
            "X-Forwarded-For": "198.51.100.50",
            "X-Real-IP": "203.0.113.9",
        },
        client_host="10.0.0.2",
    )
    assert mw._client_ip(req) == "198.51.100.77"


def test_uses_x_real_ip_when_no_cf_header() -> None:
    mw = RateLimitMiddleware(app=lambda: None)
    req = _request(
        headers={"X-Real-IP": "198.51.100.88", "X-Forwarded-For": "198.51.100.50"},
        client_host="10.0.0.2",
    )
    assert mw._client_ip(req) == "198.51.100.88"


def test_rejects_invalid_cf_connecting_ip() -> None:
    mw = RateLimitMiddleware(app=lambda: None)
    req = _request(
        headers={"CF-Connecting-IP": "not-an-ip", "X-Real-IP": "198.51.100.88"},
        client_host="10.0.0.2",
    )
    assert mw._client_ip(req) == "198.51.100.88"
