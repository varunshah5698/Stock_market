from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """In-process limiter. Single-process only: use Redis for multi-replica deployments."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            bucket = self._events[key]
            while bucket and now - bucket[0] > self.window:
                bucket.popleft()
            if len(bucket) >= self.limit:
                raise HTTPException(status_code=429, detail="Too many attempts. Please wait and try again.")
            bucket.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)


login_ip_limiter = SlidingWindowLimiter(20, 60)
login_account_limiter = SlidingWindowLimiter(6, 60)
register_limiter = SlidingWindowLimiter(5, 300)
reset_limiter = SlidingWindowLimiter(5, 300)
upload_limiter = SlidingWindowLimiter(10, 3600)
job_limiter = SlidingWindowLimiter(20, 300)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
