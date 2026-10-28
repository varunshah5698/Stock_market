from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .config import settings


class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    display_name: str = Field(default="", max_length=120)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str = Field(min_length=20, max_length=200)
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    display_name: str
    email_verified: bool
    created_at: datetime


class PreferencesIn(BaseModel):
    base_currency: str = Field(default="USD", max_length=8)
    default_market: str = Field(default="US", max_length=24)
    default_horizon: int = Field(default=5, ge=1, le=60)
    theme: Literal["dark", "light"] = "dark"
    chart_defaults: dict[str, Any] = Field(default_factory=dict)
    notifications: dict[str, Any] = Field(default_factory=dict)


class WatchlistIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    is_default: bool = False


class WatchlistItemIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    note: str = Field(default="", max_length=500)

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class ReorderIn(BaseModel):
    symbols: list[str] = Field(min_length=1, max_length=200)


class AlertIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    kind: Literal["price_above", "price_below", "pct_move", "rsi_above", "rsi_below"]
    threshold: float
    cooldown_minutes: int = Field(default=60, ge=5, le=1440)

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class AlertUpdateIn(BaseModel):
    threshold: float | None = None
    cooldown_minutes: int | None = Field(default=None, ge=5, le=1440)
    is_active: bool | None = None


class PortfolioIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    base_currency: str = Field(default="USD", max_length=8)


class PositionIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    quantity: float = Field(gt=0, le=1e12)
    avg_cost: float = Field(gt=0, le=1e12)
    notes: str = Field(default="", max_length=500)

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class ScenarioIn(BaseModel):
    weights: dict[str, float]

    @field_validator("weights")
    @classmethod
    def check(cls, v: dict[str, float]) -> dict[str, float]:
        if not v:
            raise ValueError("Provide at least one weight")
        total = sum(v.values())
        if total <= 0:
            raise ValueError("Weights must sum to a positive value")
        if any(w < 0 for w in v.values()):
            raise ValueError("Negative weights are not supported")
        return {k.upper(): w / total for k, w in v.items()}


Target = Literal["return", "direction"]
Horizon = int


class ExperimentIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    horizon: int = Field(default=5, ge=1, le=60)
    target: Target = "return"
    models: list[str] = Field(default_factory=list, max_length=20)
    test_fraction: float = Field(default=0.2, ge=0.1, le=0.35)
    validation_fraction: float = Field(default=0.2, ge=0.1, le=0.35)
    period: str = Field(default="5y", pattern=r"^(1y|2y|3y|5y|10y|max)$")

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class SweepIn(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    horizon: int = Field(default=5, ge=1, le=60)
    target: Target = "return"
    budget: int = Field(default=12, ge=2, le=50)
    test_fraction: float = Field(default=0.2, ge=0.1, le=0.35)
    period: str = Field(default="5y")

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class PredictionIn(BaseModel):
    experiment_id: str
    symbol: str | None = None


class StrategyRule(BaseModel):
    indicator: Literal[
        "price",
        "sma",
        "ema",
        "price_vs_sma",
        "rsi",
        "macd_hist",
        "bb_pctb",
        "atr_pct",
        "momentum",
        "breakout_high",
        "volatility",
        "volume_ratio",
    ]
    op: Literal[">", ">=", "<", "<=", "cross_above", "cross_below"]
    value: float | None = None
    params: dict[str, int] = Field(default_factory=dict)


class StrategyRules(BaseModel):
    entry: list[StrategyRule] = Field(default_factory=list, max_length=12)
    exit: list[StrategyRule] = Field(default_factory=list, max_length=12)
    entry_logic: Literal["all", "any"] = "all"
    exit_logic: Literal["all", "any"] = "any"
    stop_loss_pct: float | None = Field(default=None, ge=0.5, le=50)
    take_profit_pct: float | None = Field(default=None, ge=0.5, le=200)
    max_holding_days: int | None = Field(default=None, ge=1, le=500)
    position_size_pct: float = Field(default=100, ge=1, le=100)

    @field_validator("entry")
    @classmethod
    def need_entry(cls, v: list[StrategyRule]) -> list[StrategyRule]:
        if not v:
            raise ValueError("At least one entry rule is required")
        return v


class StrategyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    rules: StrategyRules


class BacktestIn(BaseModel):
    strategy_id: str
    symbol: str = Field(min_length=1, max_length=32)
    benchmark: str = Field(default="SPY", max_length=32)
    start: date | None = None
    end: date | None = None
    initial_capital: float = Field(default=100_000, ge=1_000, le=100_000_000)
    commission_bps: float = Field(default=2, ge=0, le=200)
    slippage_bps: float = Field(default=5, ge=0, le=200)
    spread_bps: float = Field(default=0, ge=0, le=200)
    position_size_pct: float | None = Field(default=None, ge=1, le=100)
    period: str = Field(default="5y", pattern=r"^(1y|2y|3y|5y|10y|max)$")

    @field_validator("symbol", "benchmark")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class PaperAccountIn(BaseModel):
    name: str = Field(default="Paper Account", min_length=1, max_length=80)
    starting_cash: float = Field(default_factory=lambda: settings.paper_starting_cash, ge=1_000, le=10_000_000)


class PaperOrderIn(BaseModel):
    account_id: str
    symbol: str = Field(min_length=1, max_length=32)
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0, le=1_000_000)
    order_type: Literal["market", "limit"] = "market"
    limit_price: float | None = Field(default=None, gt=0)
    idempotency_key: str = Field(min_length=8, max_length=80)

    @field_validator("symbol")
    @classmethod
    def normalize(cls, v: str) -> str:
        return v.strip().upper()


class BrokerConfigIn(BaseModel):
    broker: str = Field(min_length=2, max_length=40)
    account_ref: str = Field(default="", max_length=80)


class SessionOut(BaseModel):
    id: str
    created_at: datetime
    expires_at: datetime
    user_agent: str
    ip: str
    current: bool = False
