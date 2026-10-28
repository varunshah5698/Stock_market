"""Curated instrument universe.

This is a static, hand-maintained directory used for search, the screener, and
sector aggregation. It is not a claim of complete market coverage, and it is
not an index-membership history. Yahoo may fail to resolve symbols that are
renamed or delisted; the UI surfaces provider errors rather than hiding them.
"""

from __future__ import annotations

UNIVERSE: list[dict] = [
    # US equities
    {"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Consumer Electronics"},
    {"symbol": "MSFT", "name": "Microsoft Corp.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Software"},
    {"symbol": "NVDA", "name": "NVIDIA Corp.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    {"symbol": "AMZN", "name": "Amazon.com Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Consumer Discretionary", "industry": "E-Commerce"},
    {"symbol": "GOOGL", "name": "Alphabet Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Communication Services", "industry": "Internet"},
    {"symbol": "META", "name": "Meta Platforms Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Communication Services", "industry": "Internet"},
    {"symbol": "TSLA", "name": "Tesla Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Consumer Discretionary", "industry": "Autos"},
    {"symbol": "AVGO", "name": "Broadcom Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    {"symbol": "JPM", "name": "JPMorgan Chase & Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Financials", "industry": "Banks"},
    {"symbol": "V", "name": "Visa Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Financials", "industry": "Payments"},
    {"symbol": "UNH", "name": "UnitedHealth Group", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Health Care", "industry": "Insurance"},
    {"symbol": "XOM", "name": "Exxon Mobil Corp.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Energy", "industry": "Oil & Gas"},
    {"symbol": "WMT", "name": "Walmart Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Staples", "industry": "Retail"},
    {"symbol": "LLY", "name": "Eli Lilly & Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Health Care", "industry": "Pharmaceuticals"},
    {"symbol": "MA", "name": "Mastercard Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Financials", "industry": "Payments"},
    {"symbol": "PG", "name": "Procter & Gamble", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Staples", "industry": "Household Products"},
    {"symbol": "HD", "name": "Home Depot Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Discretionary", "industry": "Retail"},
    {"symbol": "COST", "name": "Costco Wholesale", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Consumer Staples", "industry": "Retail"},
    {"symbol": "JNJ", "name": "Johnson & Johnson", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Health Care", "industry": "Pharmaceuticals"},
    {"symbol": "BAC", "name": "Bank of America", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Financials", "industry": "Banks"},
    {"symbol": "NFLX", "name": "Netflix Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Communication Services", "industry": "Streaming"},
    {"symbol": "AMD", "name": "Advanced Micro Devices", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    {"symbol": "CRM", "name": "Salesforce Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Software"},
    {"symbol": "ORCL", "name": "Oracle Corp.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Software"},
    {"symbol": "ADBE", "name": "Adobe Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Software"},
    {"symbol": "CSCO", "name": "Cisco Systems", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Networking"},
    {"symbol": "PEP", "name": "PepsiCo Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Consumer Staples", "industry": "Beverages"},
    {"symbol": "KO", "name": "Coca-Cola Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Staples", "industry": "Beverages"},
    {"symbol": "MRK", "name": "Merck & Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Health Care", "industry": "Pharmaceuticals"},
    {"symbol": "CVX", "name": "Chevron Corp.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Energy", "industry": "Oil & Gas"},
    {"symbol": "QCOM", "name": "Qualcomm Inc.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    {"symbol": "TXN", "name": "Texas Instruments", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    {"symbol": "DIS", "name": "Walt Disney Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Communication Services", "industry": "Media"},
    {"symbol": "MCD", "name": "McDonald's Corp.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Discretionary", "industry": "Restaurants"},
    {"symbol": "NKE", "name": "Nike Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Consumer Discretionary", "industry": "Apparel"},
    {"symbol": "CAT", "name": "Caterpillar Inc.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Industrials", "industry": "Machinery"},
    {"symbol": "GE", "name": "GE Aerospace", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Industrials", "industry": "Aerospace"},
    {"symbol": "BA", "name": "Boeing Co.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Industrials", "industry": "Aerospace"},
    {"symbol": "IBM", "name": "IBM Corp.", "exchange": "NYSE", "market": "US", "currency": "USD", "sector": "Technology", "industry": "IT Services"},
    {"symbol": "INTC", "name": "Intel Corp.", "exchange": "NASDAQ", "market": "US", "currency": "USD", "sector": "Technology", "industry": "Semiconductors"},
    # India (NSE)
    {"symbol": "RELIANCE.NS", "name": "Reliance Industries", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Energy", "industry": "Conglomerate"},
    {"symbol": "TCS.NS", "name": "Tata Consultancy Services", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Technology", "industry": "IT Services"},
    {"symbol": "HDFCBANK.NS", "name": "HDFC Bank", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Financials", "industry": "Banks"},
    {"symbol": "INFY.NS", "name": "Infosys", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Technology", "industry": "IT Services"},
    {"symbol": "ICICIBANK.NS", "name": "ICICI Bank", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Financials", "industry": "Banks"},
    {"symbol": "SBIN.NS", "name": "State Bank of India", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Financials", "industry": "Banks"},
    {"symbol": "BHARTIARTL.NS", "name": "Bharti Airtel", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Communication Services", "industry": "Telecom"},
    {"symbol": "ITC.NS", "name": "ITC Ltd.", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Consumer Staples", "industry": "Diversified"},
    {"symbol": "LT.NS", "name": "Larsen & Toubro", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Industrials", "industry": "Construction"},
    {"symbol": "KOTAKBANK.NS", "name": "Kotak Mahindra Bank", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Financials", "industry": "Banks"},
    {"symbol": "AXISBANK.NS", "name": "Axis Bank", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Financials", "industry": "Banks"},
    {"symbol": "HINDUNILVR.NS", "name": "Hindustan Unilever", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Consumer Staples", "industry": "Household Products"},
    {"symbol": "MARUTI.NS", "name": "Maruti Suzuki", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Consumer Discretionary", "industry": "Autos"},
    {"symbol": "TATAMOTORS.NS", "name": "Tata Motors", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Consumer Discretionary", "industry": "Autos"},
    {"symbol": "SUNPHARMA.NS", "name": "Sun Pharmaceutical", "exchange": "NSE", "market": "IN", "currency": "INR", "sector": "Health Care", "industry": "Pharmaceuticals"},
    # Indices
    {"symbol": "^GSPC", "name": "S&P 500", "exchange": "INDEX", "market": "US", "currency": "USD", "sector": "Index", "industry": "Broad Market", "type": "index"},
    {"symbol": "^IXIC", "name": "Nasdaq Composite", "exchange": "INDEX", "market": "US", "currency": "USD", "sector": "Index", "industry": "Broad Market", "type": "index"},
    {"symbol": "^DJI", "name": "Dow Jones Industrial Average", "exchange": "INDEX", "market": "US", "currency": "USD", "sector": "Index", "industry": "Broad Market", "type": "index"},
    {"symbol": "^NSEI", "name": "Nifty 50", "exchange": "INDEX", "market": "IN", "currency": "INR", "sector": "Index", "industry": "Broad Market", "type": "index"},
    {"symbol": "^BSESN", "name": "BSE Sensex", "exchange": "INDEX", "market": "IN", "currency": "INR", "sector": "Index", "industry": "Broad Market", "type": "index"},
]

BENCHMARKS = {"US": "SPY", "IN": "^NSEI"}

WATCHLIST_STARTERS = ["AAPL", "MSFT", "NVDA", "RELIANCE.NS", "TCS.NS"]
