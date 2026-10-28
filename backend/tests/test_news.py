"""News feed parsing and tone heuristics.

The fixture below is a trimmed RSS document, clearly synthetic in the sense that
it is a tiny hand-written sample — it exercises the parser, not market coverage.
"""

import xml.etree.ElementTree as ET

import pytest

from app import news

FIXTURE = """<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Apple beats estimates as iPhone sales surge - CNBC</title>
    <link>https://example.test/a</link>
    <pubDate>Tue, 27 Oct 2026 14:30:00 GMT</pubDate>
    <source>CNBC</source>
  </item>
  <item>
    <title>Apple beats estimates as iPhone sales surge - CNBC</title>
    <link>https://example.test/a-duplicate</link>
    <pubDate>Tue, 27 Oct 2026 14:30:00 GMT</pubDate>
    <source>CNBC</source>
  </item>
  <item>
    <title>Apple faces antitrust probe over App Store fees - Reuters</title>
    <link>https://example.test/b</link>
    <pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate>
    <source>Reuters</source>
  </item>
  <item>
    <title>Untitled with no link</title>
    <pubDate>Mon, 26 Oct 2026 09:00:00 GMT</pubDate>
  </item>
</channel></rss>
"""


def test_parses_articles_and_drops_duplicates_and_empty_links():
    fetch = news.parse_feed(FIXTURE, "AAPL stock")
    assert len(fetch.articles) == 2, "duplicate headline and link-less item must be dropped"
    assert fetch.articles[0].title == "Apple beats estimates as iPhone sales surge"
    assert fetch.articles[0].source == "CNBC"
    assert fetch.articles[1].source == "Reuters"
    assert fetch.articles[0].published_at is not None
    assert fetch.articles[0].published_at.year == 2026


def test_tone_is_signed_and_labelled():
    fetch = news.parse_feed(FIXTURE, "AAPL stock")
    tone = news.tone_of(fetch.articles)
    # one positive ("beats", "surge") vs negative ("antitrust", "probe")
    assert tone["positive_hits"] >= 2
    assert tone["negative_hits"] >= 1
    assert -1 <= tone["score"] <= 1
    assert tone["label"] in {"positive", "negative", "mixed"}
    assert "not a provider sentiment score" in tone["method"]


def test_tone_of_empty_sample_is_mixed_zero():
    tone = news.tone_of([])
    assert tone["score"] == 0.0
    assert tone["label"] == "mixed"
    assert tone["sample"] == 0


def test_empty_feed_reports_a_warning_instead_of_inventing_articles():
    fetch = news.parse_feed("<rss><channel></channel></rss>", "nothing")
    assert fetch.articles == []
    assert any("no articles" in warning.lower() for warning in fetch.warnings)


def test_parse_feed_rejects_malformed_xml():
    with pytest.raises(ET.ParseError):
        news.parse_feed("<rss><channel>", "broken")
