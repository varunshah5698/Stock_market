"""The CSRF guard must compare against the browser's origin, not the internal hop.

On Vercel (services) and behind any reverse proxy, ``request.url`` describes the
internal request, so an exact match against it rejected legitimate mutations on
preview and custom domains. These tests pin the forwarded-header behaviour.
"""

LOGIN = "/api/v1/auth/login"
CREDENTIALS = {"email": "nobody@example.com", "password": "not-the-password"}


def test_foreign_origin_is_rejected(client):
    response = client.post(LOGIN, json=CREDENTIALS, headers={"origin": "https://evil.example.com"})
    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-origin request rejected"


def test_forwarded_host_counts_as_same_origin(client):
    # The browser origin matches x-forwarded-host even though the request that
    # reaches the app has a different (internal) host. Must not be a 403.
    headers = {
        "origin": "https://preview-abc123.vercel.app",
        "x-forwarded-host": "preview-abc123.vercel.app",
        "x-forwarded-proto": "https",
    }
    response = client.post(LOGIN, json=CREDENTIALS, headers=headers)
    assert response.status_code != 403, response.text


def test_forwarded_host_list_uses_first_entry(client):
    headers = {
        "origin": "https://outer.example.com",
        "x-forwarded-host": "outer.example.com, inner.localhost",
        "x-forwarded-proto": "https, http",
    }
    response = client.post(LOGIN, json=CREDENTIALS, headers=headers)
    assert response.status_code != 403, response.text


def test_mismatched_forwarded_host_is_still_rejected(client):
    headers = {
        "origin": "https://evil.example.com",
        "x-forwarded-host": "preview-abc123.vercel.app",
        "x-forwarded-proto": "https",
    }
    response = client.post(LOGIN, json=CREDENTIALS, headers=headers)
    assert response.status_code == 403


def test_no_origin_header_is_not_blocked(client):
    # Non-browser clients (cron, curl) send no Origin; the cookie/CSRF design
    # still relies on the session cookie, so this must not 403.
    response = client.post(LOGIN, json=CREDENTIALS)
    assert response.status_code != 403, response.text
