from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DbSession

from ..config import settings
from ..db import get_db
from ..deps import audit, current_user
from ..models import Dataset, User, uid
from ..ratelimit import client_ip, upload_limiter
from ..ml.validation import to_builtin

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])
BASE_DIR = Path(__file__).resolve().parents[2]
DATASET_DIR = BASE_DIR / "storage" / "datasets"
DATASET_DIR.mkdir(parents=True, exist_ok=True)

MAX_ROWS = 200_000
TIMESTAMP_HINTS = ["timestamp", "datetime", "date", "time", "ts", "index"]
CLOSE_HINTS = ["close", "adj_close", "adjclose", "close_price", "price", "last"]
FIELD_HINTS = {
    "open": ["open"],
    "high": ["high"],
    "low": ["low"],
    "close": ["close", "adj_close", "adjclose", "close_price", "price"],
    "volume": ["volume", "vol"],
    "symbol": ["symbol", "ticker", "instrument"],
    "target": ["target", "label", "y"],
}
SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]")


def _read_text(file_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=422, detail="Unable to decode CSV; use UTF-8 or Latin-1 text.")


async def _load_upload(file: UploadFile) -> tuple[str, str]:
    if not file.filename:
        raise HTTPException(status_code=422, detail="No filename supplied")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Only .csv files are accepted")
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File exceeds the {settings.max_upload_mb} MB limit")
    if not data:
        raise HTTPException(status_code=422, detail="File is empty")
    text = _read_text(data)
    raw_name = file.filename.replace("\\", "/").split("/")[-1]
    safe_name = SAFE_FILENAME.sub("_", raw_name).strip("._ ")[:120] or "dataset.csv"
    header_line = text.splitlines()[0] if text.splitlines() else ""
    try:
        headers = next(csv.reader([header_line]))
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid CSV header")
    cleaned = [h.strip() for h in headers]
    if len(set(cleaned)) != len(cleaned):
        raise HTTPException(status_code=422, detail="Duplicate column names are not allowed")
    if not cleaned:
        raise HTTPException(status_code=422, detail="CSV has no columns")
    return text, safe_name


def _read_frame(text: str) -> pd.DataFrame:
    try:
        frame = pd.read_csv(io.StringIO(text), dtype=str, keep_default_na=False, na_values=[""], low_memory=False)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"CSV parsing failed: {str(exc)[:200]}")
    frame.columns = [str(c).strip() for c in frame.columns]
    if len(frame) > MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"Row limit is {MAX_ROWS:,}")
    if frame.empty:
        raise HTTPException(status_code=422, detail="CSV contains no data rows")
    return frame


def _infer_mapping(columns: list[str]) -> dict:
    lower = {c.lower().strip(): c for c in columns}
    mapping: dict[str, str | None] = {"timestamp": None, "close": None, "open": None, "high": None, "low": None, "volume": None, "symbol": None}
    for hint in TIMESTAMP_HINTS:
        if hint in lower:
            mapping["timestamp"] = lower[hint]
            break
    for field, hints in FIELD_HINTS.items():
        if field == "target":
            continue
        for hint in hints:
            if hint in lower:
                mapping[field] = lower[hint]
                break
    if mapping["timestamp"] is None:
        first = columns[0] if columns else None
        mapping["timestamp"] = first
    if mapping["close"] is None:
        mapping["close"] = mapping["timestamp"]
    return mapping


@router.post("/preview")
async def preview(
    file: UploadFile = File(...),
    user: User = Depends(current_user),
):
    upload_limiter.check(f"upload:{user.id}")
    text, filename = await _load_upload(file)
    frame = _read_frame(text)
    columns = list(frame.columns)
    mapping = _infer_mapping(columns)
    sample = frame.head(8).fillna("").to_dict(orient="records")
    numeric_candidates = []
    for col in columns[:80]:
        parsed = pd.to_numeric(frame[col], errors="coerce")
        ratio = float(parsed.notna().mean()) if len(frame) else 0
        if ratio > 0.8:
            numeric_candidates.append(col)
    return {
        "filename": SAFE_FILENAME.sub("_", filename)[:120],
        "rows": len(frame),
        "columns": columns,
        "inferred_mapping": mapping,
        "numeric_candidates": numeric_candidates,
        "sample": sample,
        "limits": {"max_mb": settings.max_upload_mb, "max_rows": MAX_ROWS, "format": "CSV only"},
        "warnings": [
            "Uploaded data is user-supplied and is never treated as a live market feed.",
            "Only CSV text is parsed. No macros, scripts or formulas are executed.",
        ],
    }


def _parse_dates(series: pd.Series, date_format: str | None) -> pd.Series:
    numeric = pd.to_numeric(series, errors="coerce")
    if numeric.notna().mean() > 0.8:
        sample = numeric.dropna()
        if len(sample) and float(sample.abs().max()) > 1e12:
            parsed = pd.to_datetime(numeric, unit="ms", errors="coerce", utc=True)
        elif len(sample) and float(sample.abs().max()) > 1e9:
            parsed = pd.to_datetime(numeric, unit="s", errors="coerce", utc=True)
        else:
            parsed = pd.to_datetime(series, errors="coerce", utc=True, format=date_format or None)
    else:
        parsed = pd.to_datetime(series, errors="coerce", utc=True, format=date_format or None)
    return parsed


def _clean(frame: pd.DataFrame, mapping: dict, date_format: str | None, policy: dict) -> tuple[pd.DataFrame, dict]:
    if not mapping.get("timestamp") or not mapping.get("close"):
        raise HTTPException(status_code=422, detail="Column mapping must include timestamp and close")
    for field in ("timestamp", "close", "open", "high", "low", "volume", "symbol"):
        col = mapping.get(field)
        if col and col not in frame.columns:
            raise HTTPException(status_code=422, detail=f"Mapped column '{col}' does not exist in the file")
    report: dict = {"rows_in": len(frame), "missing_by_column": {}, "dropped": {}, "ohlc_violations": 0, "duplicate_rows": 0}
    working = pd.DataFrame(index=frame.index)
    for col in frame.columns:
        missing = int(frame[col].isna().sum())
        if missing:
            report["missing_by_column"][col] = missing

    working["timestamp"] = _parse_dates(frame[mapping["timestamp"]], date_format)
    invalid_dates = int(working["timestamp"].isna().sum())
    working["close"] = pd.to_numeric(frame[mapping["close"]], errors="coerce")
    invalid_close = int(working["close"].isna().sum())
    for field in ("open", "high", "low"):
        if mapping.get(field):
            working[field] = pd.to_numeric(frame[mapping[field]], errors="coerce")
        else:
            working[field] = working["close"]
    if mapping.get("volume"):
        working["volume"] = pd.to_numeric(frame[mapping["volume"]], errors="coerce").fillna(0).clip(lower=0)
    else:
        working["volume"] = 0.0
    if mapping.get("symbol"):
        working["symbol"] = frame[mapping["symbol"]].astype(str).str.strip().str.upper().replace({"NAN": ""})
    else:
        working["symbol"] = ""
    if mapping.get("target"):
        working["target"] = pd.to_numeric(frame[mapping["target"]], errors="coerce")

    working["adj_close"] = working["close"]
    before = len(working)
    non_positive = int((working["close"] <= 0).sum())
    working = working[working["timestamp"].notna() & working["close"].notna() & (working["close"] > 0)]
    report["dropped"]["invalid_timestamp_or_close"] = before - len(working)
    report["dropped"]["non_positive_close"] = non_positive
    report["invalid_dates"] = invalid_dates
    report["invalid_close"] = invalid_close

    reference_high = working[["open", "close"]].max(axis=1)
    reference_low = working[["open", "close"]].min(axis=1)
    violations = (
        (working["high"] < working["low"])
        | (working["high"] < reference_high)
        | (working["low"] > reference_low)
    )
    report["ohlc_violations"] = int(violations.sum())
    if policy.get("drop_ohlc_violations"):
        working = working[~violations]
        report["dropped"]["ohlc_violations"] = int(violations.sum())

    dedupe = policy.get("drop_duplicates", True)
    before = len(working)
    if dedupe:
        working = working.sort_values("timestamp").drop_duplicates(subset=["timestamp", "symbol"], keep="last")
    report["duplicate_rows"] = before - len(working)
    working = working.sort_values("timestamp").reset_index(drop=True)
    report["rows_out"] = len(working)
    if working.empty:
        raise HTTPException(status_code=422, detail="No valid rows remain after cleaning")

    span_days = (working["timestamp"].max() - working["timestamp"].min()).total_seconds() / 86400
    business_days = int(np.busday_count(working["timestamp"].min().date(), working["timestamp"].max().date())) + 1
    report["date_range"] = {
        "start": str(working["timestamp"].min().date()),
        "end": str(working["timestamp"].max().date()),
        "span_days": round(span_days, 2),
    }
    report["approx_missing_business_days"] = max(0, business_days - len(working))
    report["duplicates_policy"] = "keep last by timestamp+symbol" if dedupe else "keep all"
    report["symbols"] = int(working["symbol"].replace("", np.nan).nunique()) if "symbol" in working else 0
    report["warnings"] = []
    if report["ohlc_violations"]:
        report["warnings"].append(f"{report['ohlc_violations']} rows have inconsistent OHLC relationships.")
    if report["approx_missing_business_days"] > 0:
        report["warnings"].append(f"About {report['approx_missing_business_days']} business days are absent; holidays may explain some gaps.")
    if report["symbols"] > 20:
        report["warnings"].append("More than 20 symbols detected; single-instrument research assumes one symbol.")
    if working["symbol"].replace("", np.nan).nunique() > 1:
        report["warnings"].append("Multiple symbols detected. Values are not combined in this build; filter on export.")
    return working, report


@router.post("")
async def upload_dataset(
    file: UploadFile = File(...),
    mapping: str = Form(...),
    name: str = Form(""),
    date_format: str = Form(""),
    drop_ohlc_violations: bool = Form(False),
    user: User = Depends(current_user),
    db: DbSession = Depends(get_db),
):
    upload_limiter.check(f"upload:{user.id}")
    try:
        mapping_obj = json.loads(mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="Mapping must be valid JSON")
    if not isinstance(mapping_obj, dict):
        raise HTTPException(status_code=422, detail="Mapping must be an object")
    text, filename = await _load_upload(file)
    frame = _read_frame(text)
    cleaned, report = _clean(
        frame,
        mapping_obj,
        date_format.strip() or None,
        {"drop_duplicates": True, "drop_ohlc_violations": drop_ohlc_violations},
    )
    dataset_id = uid()
    path = DATASET_DIR / f"{dataset_id}.csv"
    cleaned.to_csv(path, index=False)
    schema = {
        "columns": list(cleaned.columns),
        "mapping": mapping_obj,
        "dtypes": {c: str(cleaned[c].dtype) for c in cleaned.columns},
        "dictionary": {
            "timestamp": "UTC timestamp parsed from the mapped column",
            "open/high/low/close": "User-supplied numeric prices (never treated as live data)",
            "adj_close": "Set equal to close; adjusted close is not inferred",
            "volume": "User-supplied volume, non-negative, default 0",
            "symbol": "Optional user-supplied instrument identifier",
        },
    }
    dataset = Dataset(
        id=dataset_id,
        user_id=user.id,
        name=(name.strip() or Path(SAFE_FILENAME.sub("_", filename)).stem)[:120],
        original_filename=SAFE_FILENAME.sub("_", filename)[:255],
        storage_path=str(path.relative_to(BASE_DIR)),
        rows=len(cleaned),
        columns=list(cleaned.columns),
        schema_json=schema,
        validation={**report, "currency": "user_supplied", "price_basis": "user data, unverified"},
        status="validated",
        version=1,
    )
    db.add(dataset)
    audit(db, user.id, "dataset.upload", target=dataset.id, rows=len(cleaned))
    db.commit()
    return {
        "dataset": _dataset_dict(dataset),
        "validation": report,
        "preview": cleaned.head(20).astype(str).to_dict(orient="records"),
        "analysis_options": {
            "statistics": True,
            "correlations": True,
            "distribution": True,
            "technical_features": False,
            "launch_experiment": False,
            "reason": "Uploaded datasets are validated and analysed but not yet fed into the live-stock experiment runner, which requires a symbol history with OHLCV semantics.",
        },
        "warnings": report["warnings"] + ["User-supplied data is not a live market feed and is stored for this account only."],
    }


def _dataset_dict(d: Dataset) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "original_filename": d.original_filename,
        "rows": d.rows,
        "columns": d.columns,
        "schema": d.schema_json,
        "validation": d.validation,
        "status": d.status,
        "version": d.version,
        "created_at": d.created_at.isoformat(),
    }


def _owned(db: DbSession, user: User, dataset_id: str) -> Dataset:
    row = db.query(Dataset).filter(Dataset.id == dataset_id, Dataset.user_id == user.id, Dataset.deleted_at.is_(None)).first()
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return row


def _read_dataset(d: Dataset) -> pd.DataFrame:
    path = (BASE_DIR / d.storage_path).resolve()
    root = DATASET_DIR.resolve()
    if not str(path).startswith(str(root) + "/") or not path.exists():
        raise HTTPException(status_code=410, detail="Dataset file is no longer available")
    frame = pd.read_csv(path)
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], errors="coerce", utc=True)
    return frame


@router.get("")
def list_datasets(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    rows = (
        db.query(Dataset)
        .filter(Dataset.user_id == user.id, Dataset.deleted_at.is_(None))
        .order_by(Dataset.created_at.desc())
        .all()
    )
    return {"datasets": [_dataset_dict(d) for d in rows]}


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    dataset = _owned(db, user, dataset_id)
    return {"dataset": _dataset_dict(dataset)}


@router.get("/{dataset_id}/stats")
def stats(dataset_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    dataset = _owned(db, user, dataset_id)
    frame = _read_dataset(dataset)
    numeric = frame.select_dtypes(include=[np.number])
    describe = {}
    missing = {}
    for col in frame.columns:
        missing[col] = round(float(frame[col].isna().mean()) * 100, 4)
    for col in numeric.columns:
        series = numeric[col].dropna()
        if series.empty:
            continue
        describe[col] = {
            "count": int(series.count()),
            "mean": float(series.mean()),
            "std": float(series.std(ddof=0)),
            "min": float(series.min()),
            "q25": float(series.quantile(0.25)),
            "median": float(series.median()),
            "q75": float(series.quantile(0.75)),
            "max": float(series.max()),
        }
    corr = None
    if len(numeric.columns) >= 2:
        corr_frame = numeric.dropna().corr()
        corr = {"columns": list(corr_frame.columns), "matrix": [[round(float(v), 4) if np.isfinite(v) else None for v in row] for row in corr_frame.to_numpy()]}
    close_hist = None
    if "close" in frame.columns and len(frame) > 10:
        returns = frame["close"].astype(float).pct_change().dropna()
        counts, edges = np.histogram(returns, bins=min(30, max(5, int(np.sqrt(len(returns))))))
        close_hist = {
            "counts": [int(c) for c in counts],
            "edges": [round(float(e), 6) for e in edges],
            "unit": "simple return",
        }
    symbol_counts = None
    if "symbol" in frame.columns and frame["symbol"].replace("", np.nan).nunique() > 1:
        symbol_counts = frame["symbol"].value_counts().head(20).to_dict()
    return to_builtin(
        {
            "dataset_id": dataset.id,
            "rows": len(frame),
            "date_range": {
                "start": str(frame["timestamp"].min().date()) if frame["timestamp"].notna().any() else None,
                "end": str(frame["timestamp"].max().date()) if frame["timestamp"].notna().any() else None,
            },
            "describe": describe,
            "missing_pct": missing,
            "correlation": corr,
            "close_return_histogram": close_hist,
            "symbol_counts": symbol_counts,
            "validation": dataset.validation,
            "note": "Statistics describe the uploaded file. They do not validate it as a market-data feed.",
        }
    )


@router.get("/{dataset_id}/export.csv")
def export_dataset(dataset_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    dataset = _owned(db, user, dataset_id)
    frame = _read_dataset(dataset)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(list(frame.columns))

    def safe(value):
        if isinstance(value, str) and value[:1] in ("=", "+", "-", "@"):
            return "'" + value
        return value

    for row in frame.itertuples(index=False):
        writer.writerow([safe(v) for v in row])
    buffer.seek(0)
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=stockpulse-dataset-{dataset.id}.csv"},
    )


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    dataset = _owned(db, user, dataset_id)
    path = (BASE_DIR / dataset.storage_path).resolve()
    root = DATASET_DIR.resolve()
    if str(path).startswith(str(root) + "/") and path.exists():
        path.unlink()
    audit(db, user.id, "dataset.delete", target=dataset.id)
    db.delete(dataset)
    db.commit()
    return {"deleted": True}
