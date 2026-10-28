import os
import tempfile
import time

os.environ["APP_ENV"] = "test"
os.environ["SECRET_KEY"] = "test-secret-key-with-at-least-32-characters"
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["MARKET_DATA_PROVIDER"] = "sample"
os.environ["BACKGROUND_JOBS"] = "false"
os.environ["COOKIE_SECURE"] = "false"

import pytest
from fastapi.testclient import TestClient

from app.db import init_db
from app.main import app


@pytest.fixture(scope="session")
def client():
    init_db()
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def reset_rate_limiters():
    from app import ratelimit

    for limiter in (
        ratelimit.login_ip_limiter,
        ratelimit.login_account_limiter,
        ratelimit.register_limiter,
        ratelimit.reset_limiter,
        ratelimit.upload_limiter,
        ratelimit.job_limiter,
    ):
        limiter._events.clear()


def register(client: TestClient, email: str, password: str = "TestPassword123"):
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": "Test User"},
    )


@pytest.fixture
def auth_client(client):
    client.cookies.clear()
    r = register(client, f"user{int(time.time() * 1000000)}@example.com")
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def second_client():
    with TestClient(app) as c:
        r = register(c, f"other{int(time.time() * 1000000)}@example.com")
        assert r.status_code == 200, r.text
        yield c
