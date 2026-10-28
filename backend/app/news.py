"""Live market news.

Google News RSS is the source: no API key, real published articles with
timestamps, reachable from serverless. ``NEWS_API_KEY`` is accepted for a future
licensed provider, but nothing here fabricates a headline — if the feed is
unreachable the caller gets an explicit error and no articles.

Coverage limits, stated plainly:
  * Headlines only. No article body is fetched or stored.
  * Google News is an aggregator, so syndicated duplicates appear; they are
    de-duplicated by headline, not by story.
  * The tone figure is a transparent keyword heuristic computed here. It is NOT
    a provider sentiment score and NOT a model input.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import httpx

RSS_ENDPOINT = "https://news.google.com/rss/search"
PROVIDER = "google_news_rss"
CACHE_TTL = timedelta(minutes=10)
_TAG = re.compile(r"<[^>]+>")
_JUNK_TITLE = re.compile(r"^[A-Z0-9_]+$")  # e.g. META_TITLE_QUOTE placeholders
_SUFFIXES = re.compile(r"\b(Inc\.?|Corp\.?|Corporation|Ltd\.?|plc|Co\.?|Holdings|Class [A-C])\b")


def query_for_symbol(symbol: str) -> str:
    """Build a precise news query from the curated universe, not just a ticker.

    "AAPL stock" matches loosely and drags in unrelated market wrap-ups, so the
    company name is used and quoted when the universe knows it.
    """
    symbol = (symbol or "").strip().upper()
    if not symbol:
        return "stock market today"
    try:
        from .marketdata.universe import UNIVERSE

        name = next((row["name"] for row in UNIVERSE if row["symbol"] == symbol), None)
    except Exception:  # never let a lookup failure block the feed
        name = None
    if name:
        cleaned = _SUFFIXES.sub("", name).strip(" ,.")
        if cleaned:
            return f'"{cleaned}"'
    return f'"{symbol}" stock'

# Deliberately small and inspectable. A keyword score is a crude signal; the
# point is that the method is visible and reproducible, not that it is clever.
POSITIVE = (
    "beat", "beats", "surge", "surges", "rally", "rallies", "record high", "upgrade",
    "upgraded", "profit", "growth", "strong", "outperform", "wins", "raises", "soar",
    "soars", "jumps", "expands", "buyback", "dividend", "tops", "gain", "gains",
)
NEGATIVE = (
    "miss", "misses", "plunge", "plunges", "slump", "slumps", "downgrade", "downgraded",
    "loss", "losses", "lawsuit", "probe", "investigation", "recall", "layoff", "layoffs",
    "falls", "drops", "sinks", "warns", "warning", "weak", "underperform", "cuts",
    "cut", "antitrust", "fraud", "decline", "declines", "selloff", "halt",
)
TONE_METHOD = (
    "keyword heuristic over headlines (positive/negative finance terms); "
    "not a provider sentiment score"
)


@dataclass
class NewsArticle:
    title: str
    url: str
    source: str
    published_at: datetime | None

    def as_dict(self) -> dict:
        return {
            "title": self.title,
            "url": self.url,
            "source": self.source,
            "published_at": self.published_at.isoformat() if self.published_at else None,
        }


@dataclass
class NewsFetch:
    query: str
    fetched_at: datetime
    articles: list[NewsArticle] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    from_cache: bool = False


_cache: dict[str, tuple[datetime, NewsFetch]] = {}


def _clean(text: str) -> str:
    return _TAG.sub("", text or "").replace("&amp;", "&").strip()


def parse_feed(text: str, query: str) -> NewsFetch:
    """Parse an RSS document. Kept pure so tests can feed a fixture."""
    root = ET.fromstring(text)
    articles: list[NewsArticle] = []
    seen: set[str] = set()
    for item in root.iter("item"):
        title = _clean(item.findtext("title") or "")
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        # Google News publishes "<headline> - <publisher>"; split it back out.
        source = _clean(item.findtext("source") or "")
        headline = title
        if " - " in title:
            headline, _, trailing = title.rpartition(" - ")
            source = source or trailing.strip()
        if not headline or headline.lower() in seen:
            continue
        if _JUNK_TITLE.match(headline) or len(headline) < 18:
            continue  # provider placeholder artefact, not a real headline
        seen.add(headline.lower())
        published: datetime | None = None
        raw_date = item.findtext("pubDate")
        if raw_date:
            try:
                published = parsedate_to_datetime(raw_date).astimezone(timezone.utc)
            except (TypeError, ValueError):
                published = None
        articles.append(NewsArticle(title=headline, url=link, source=source, published_at=published))
    fetch = NewsFetch(query=query, fetched_at=datetime.now(timezone.utc), articles=articles)
    if not articles:
        fetch.warnings.append("The provider returned no articles for this query.")
    return fetch


def fetch_news(query: str, limit: int = 20, timeout: float = 8.0, use_cache: bool = True) -> NewsFetch:
    """Live fetch with a short cache so a page refresh cannot hammer the feed."""
    key = (query or "").strip().lower()
    if use_cache:
        cached = _cache.get(key)
        if cached and datetime.now(timezone.utc) - cached[0] < CACHE_TTL:
            copy = NewsFetch(
                query=cached[1].query,
                fetched_at=cached[1].fetched_at,
                articles=list(cached[1].articles)[:limit],
                warnings=list(cached[1].warnings),
                from_cache=True,
            )
            return copy
    params = {"q": query, "hl": "en-US", "gl": "US", "ceid": "US:en"}
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        response = client.get(
            RSS_ENDPOINT, params=params, headers={"User-Agent": "StockPulseAI/0.1 (+research prototype)"}
        )
    response.raise_for_status()
    fetch = parse_feed(response.text, query)
    _cache[key] = (datetime.now(timezone.utc), fetch)
    fetch.articles = fetch.articles[:limit]
    return fetch


def tone_of(articles: list[NewsArticle]) -> dict:
    """Transparent keyword tone over the supplied headlines."""
    positive = negative = 0
    for article in articles:
        text = article.title.lower()
        positive += sum(1 for word in POSITIVE if word in text)
        negative += sum(1 for word in NEGATIVE if word in text)
    total = positive + negative
    score = (positive - negative) / total if total else 0.0
    label = "mixed" if total == 0 else "positive" if score > 0.15 else "negative" if score < -0.15 else "mixed"
    return {
        "score": round(score, 4),
        "label": label,
        "positive_hits": positive,
        "negative_hits": negative,
        "sample": len(articles),
        "method": TONE_METHOD,
    }


def news_payload(query: str, limit: int = 20) -> dict:
    fetch = fetch_news(query, limit=limit)
    articles = fetch.articles
    newest = max((a.published_at for a in articles if a.published_at), default=None)
    return {
        "query": fetch.query,
        "provider": PROVIDER,
        "provider_mode": "keyless public RSS aggregator",
        "fetched_at": fetch.fetched_at.isoformat(),
        "from_cache": fetch.from_cache,
        "cache_ttl_minutes": int(CACHE_TTL.total_seconds() // 60),
        "count": len(articles),
        "newest_published_at": newest.isoformat() if newest else None,
        "tone": tone_of(articles),
        "articles": [article.as_dict() for article in articles],
        "warnings": fetch.warnings
        + [
            "Headlines only; article bodies are not fetched or stored.",
            "Aggregated coverage may contain syndicated duplicates.",
            "News tone is a keyword heuristic, not provider sentiment, and is not a model input.",
        ],
    }


def prediction_context(symbol: str, limit: int = 5) -> dict | None:
    """Best-effort news snapshot stored with a prediction. Never raises."""
    try:
        fetch = fetch_news(query_for_symbol(symbol), limit=limit, timeout=5.0)
    except Exception as exc:  # a provider outage must not break a prediction
        return {
            "available": False,
            "provider": PROVIDER,
            "error": f"{type(exc).__name__}: {str(exc)[:160]}",
            "note": "News unavailable at prediction time; the forecast was produced without it.",
        }
    articles = fetch.articles
    newest = max((a.published_at for a in articles if a.published_at), default=None)
    return {
        "available": bool(articles),
        "provider": PROVIDER,
        "fetched_at": fetch.fetched_at.isoformat(),
        "query": fetch.query,
        "article_count": len(articles),
        "newest_published_at": newest.isoformat() if newest else None,
        "tone": tone_of(articles),
        "headlines": [article.as_dict() for article in articles[:3]],
        "used_as_model_input": False,
        "note": (
            "Live news context stored alongside the forecast. It is NOT a trained feature, so it does not "
            "change the predicted value; using it as a feature requires a historical news series and a "
            "validation run."
        ),
    }

