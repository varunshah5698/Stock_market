from __future__ import annotations

import time


def unique_email(prefix="u"):
    return f"{prefix}{int(time.time() * 1_000_000)}@example.com"


def test_register_validation_and_duplicate(client):
    client.cookies.clear()
    email = unique_email()
    weak = client.post("/api/v1/auth/register", json={"email": email, "password": "short"})
    assert weak.status_code == 422
    bad_email = client.post("/api/v1/auth/register", json={"email": "not-an-email", "password": "ValidPassword123"})
    assert bad_email.status_code == 422
    ok = client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123", "display_name": "A"})
    assert ok.status_code == 200, ok.text
    assert client.cookies.get("sp_session")
    assert client.get("/api/v1/auth/me").status_code == 200
    client.cookies.clear()
    duplicate = client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"})
    assert duplicate.status_code == 409


def test_login_logout_and_wrong_password(client):
    email = unique_email("login")
    client.cookies.clear()
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"}).status_code == 200
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/auth/me").status_code == 401
    wrong = client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword123"})
    assert wrong.status_code == 401
    right = client.post("/api/v1/auth/login", json={"email": email, "password": "ValidPassword123"})
    assert right.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401


def test_password_reset_revokes_sessions(client):
    email = unique_email("reset")
    client.cookies.clear()
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"}).status_code == 200
    old_cookie = client.cookies.get("sp_session")
    forgot = client.post("/api/v1/auth/forgot-password", json={"email": email})
    assert forgot.status_code == 200
    token = forgot.json().get("development_reset_token")
    assert token
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert unknown.status_code == 200
    assert "development_reset_token" not in unknown.json()
    reset = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "NewPassword456"})
    assert reset.status_code == 200
    client.cookies.set("sp_session", old_cookie)
    assert client.get("/api/v1/auth/me").status_code == 401
    reused = client.post("/api/v1/auth/reset-password", json={"token": token, "password": "AnotherPassword789"})
    assert reused.status_code == 400
    client.cookies.clear()
    assert client.post("/api/v1/auth/login", json={"email": email, "password": "NewPassword456"}).status_code == 200


def test_protected_routes_require_session(client):
    client.cookies.clear()
    for path in [
        "/api/v1/auth/me",
        "/api/v1/markets/overview",
        "/api/v1/watchlists",
        "/api/v1/portfolios",
        "/api/v1/ml/experiments",
        "/api/v1/paper-trading/accounts",
        "/api/v1/system/status",
    ]:
        assert client.get(path).status_code == 401, path


def test_password_is_hashed_not_plaintext(auth_client):
    from app.db import SessionLocal
    from app.models import User

    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email.like("%@example.com")).order_by(User.created_at.desc()).first()
        assert user is not None
        assert user.password_hash != "TestPassword123"
        assert user.password_hash.startswith("$argon2")
    finally:
        db.close()


def test_security_headers_and_csrf(auth_client):
    r = auth_client.get("/api/v1/auth/me")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in r.headers
    evil = auth_client.post(
        "/api/v1/watchlists",
        json={"name": "CSRF attempt"},
        headers={"origin": "http://evil.example"},
    )
    assert evil.status_code == 403


def test_timestamps_are_serialised_as_utc(auth_client):
    me = auth_client.get("/api/v1/auth/me").json()
    created = me["user"]["created_at"]
    assert created.endswith("Z") or created.endswith("+00:00"), created


def test_change_password_revokes_other_sessions(auth_client):
    from app.main import app
    from fastapi.testclient import TestClient

    email = f"change{int(time.time() * 1000000)}@example.com"
    auth_client.cookies.clear()
    assert auth_client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"}).status_code == 200
    with TestClient(app) as other:
        assert other.post("/api/v1/auth/login", json={"email": email, "password": "ValidPassword123"}).status_code == 200
        assert other.get("/api/v1/auth/me").status_code == 200
        changed = auth_client.post(
            "/api/v1/auth/change-password",
            json={"current_password": "ValidPassword123", "new_password": "ChangedPassword456"},
        )
        assert changed.status_code == 200, changed.text
        assert other.get("/api/v1/auth/me").status_code == 401
    assert auth_client.post("/api/v1/auth/logout").status_code == 200
    assert auth_client.post("/api/v1/auth/login", json={"email": email, "password": "ValidPassword123"}).status_code == 401
    assert auth_client.post("/api/v1/auth/login", json={"email": email, "password": "ChangedPassword456"}).status_code == 200


def test_login_rate_limit_returns_429(client):
    email = f"limit{int(time.time() * 1000000)}@example.com"
    client.cookies.clear()
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"}).status_code == 200
    client.post("/api/v1/auth/logout")
    statuses = []
    for _ in range(7):
        statuses.append(client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword999"}).status_code)
    assert 429 in statuses, statuses


def test_account_deletion_removes_rows_files_and_access():
    import json
    from pathlib import Path
    from fastapi.testclient import TestClient
    from app.db import SessionLocal
    from app.main import app
    from app.models import Dataset

    with TestClient(app) as account:
        email = f"delete{int(time.time() * 1000000)}@example.com"
        assert account.post("/api/v1/auth/register", json={"email": email, "password": "ValidPassword123"}).status_code == 200
        portfolio = account.post("/api/v1/portfolios", json={"name": "To delete"}).json()
        assert account.post("/api/v1/watchlists", json={"name": "To delete"}).status_code == 200
        csv = "Date,Close\n2024-01-02,100\n2024-01-03,101\n2024-01-04,102\n"
        uploaded = account.post(
            "/api/v1/datasets",
            files={"file": ("sample.csv", csv, "text/csv")},
            data={"mapping": json.dumps({"timestamp": "Date", "close": "Close"}), "name": "Delete me"},
        )
        assert uploaded.status_code == 200, uploaded.text
        dataset_id = uploaded.json()["dataset"]["id"]
        db = SessionLocal()
        try:
            dataset = db.get(Dataset, dataset_id)
            path = Path(dataset.storage_path)
            assert (Path.cwd() / path).exists()
        finally:
            db.close()
        deleted = account.request(
            "DELETE",
            "/api/v1/settings/account",
            json={"password": "ValidPassword123", "confirm": "DELETE"},
        )
        assert deleted.status_code == 200, deleted.text
        assert not (Path.cwd() / path).exists()
        assert account.get("/api/v1/auth/me").status_code == 401
        assert account.post("/api/v1/auth/login", json={"email": email, "password": "ValidPassword123"}).status_code == 401
        assert account.request("GET", f"/api/v1/portfolios/{portfolio['id']}").status_code == 401
