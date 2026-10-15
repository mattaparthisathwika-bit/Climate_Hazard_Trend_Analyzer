from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from backend.data_processor import clean_and_prepare_weather_dataframe
from backend.database import db
from backend.hazard_engine import run_hazard_detection_and_trends
from backend.insights_generator import generate_climate_insights
from backend.schemas import AnalyzeRequest, GeocodeQuery
from backend.weather_client import (
    PRESET_REGIONS,
    compute_sampling_coordinates,
    ingest_historical_weather,
    search_geocoding,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("climate_analyzer.api")

app = FastAPI(
    title="Climate Hazard Trend Analyzer API",
    description=(
        "Full-Stack Climate Hazard Trend Analyzer built for the Dygnify Ventures Case Study. "
        "Ingests and caches historical weather data in a NoSQL database, detects extreme weather "
        "hazards (Heatwaves, Heavy Rainfall, Droughts), and computes OLS regression, rolling averages, "
        "and Mann-Kendall statistical trends."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-Process-Time-Ms"],
)

# ---------------------------------------------------------------------------
# Security & Performance: Sliding-Window Rate Limiter + Security Headers
# ---------------------------------------------------------------------------
RATE_LIMIT_WINDOW_SEC = 60
RATE_LIMIT_MAX_REQUESTS = 45
_ip_request_log: Dict[str, Deque[float]] = defaultdict(deque)


@app.middleware("http")
async def security_and_rate_limit_middleware(request: Request, call_next):
    start_ts = time.perf_counter()
    client_ip = request.client.host if request.client else "127.0.0.1"
    now = time.time()

    # Prune timestamps older than 60s
    history = _ip_request_log[client_ip]
    while history and (now - history[0]) > RATE_LIMIT_WINDOW_SEC:
        history.popleft()

    if len(history) >= RATE_LIMIT_MAX_REQUESTS:
        return JSONResponse(
            status_code=429,
            content={
                "detail": "Rate limit exceeded. Please wait before submitting additional climate analysis queries.",
                "retry_after_seconds": RATE_LIMIT_WINDOW_SEC,
            },
            headers={
                "X-RateLimit-Limit": str(RATE_LIMIT_MAX_REQUESTS),
                "X-RateLimit-Remaining": "0",
            },
        )

    history.append(now)
    remaining = max(0, RATE_LIMIT_MAX_REQUESTS - len(history))

    response: Response = await call_next(request)
    elapsed_ms = round((time.perf_counter() - start_ts) * 1000.0, 2)

    response.headers["X-RateLimit-Limit"] = str(RATE_LIMIT_MAX_REQUESTS)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-Process-Time-Ms"] = str(elapsed_ms)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


def build_analysis_cache_key(req: AnalyzeRequest) -> str:
    coords = compute_sampling_coordinates(req)
    coord_str = ";".join(f"{lat:.3f},{lon:.3f}" for lat, lon in coords)
    raw = (
        f"v1|{coord_str}|{req.hazard_type.value}|{req.start_year}|{req.end_year}|"
        f"{req.percentile_threshold:.1f}|{req.min_consecutive_days}|"
        f"{req.unit.value}|{req.use_dynamic_calendar_percentile}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    return {
        "status": "healthy",
        "service": "Climate Hazard Trend Analyzer API",
        "database": db.get_stats(),
    }


@app.get("/api/regions/presets")
async def get_preset_regions() -> Dict[str, Any]:
    return {
        "presets": PRESET_REGIONS,
        "count": len(PRESET_REGIONS),
    }


@app.get("/api/regions/geocode")
async def geocode_region(q: str = Query(..., min_length=2, max_length=100)) -> Dict[str, Any]:
    validated = GeocodeQuery(q=q)
    results = await search_geocoding(validated.q)
    return {
        "query": validated.q,
        "results": results,
    }


@app.get("/api/analyses/recent")
async def list_recent_analyses() -> Dict[str, Any]:
    return {
        "recent_analyses": db.get_recent_analyses(limit=10),
        "database": db.get_stats(),
    }


@app.post("/api/analyze")
async def analyze_climate_hazard(req: AnalyzeRequest) -> Dict[str, Any]:
    """
    Core endpoint:
    1. Checks the NoSQL `hazard_analyses` collection for a cached analysis matching the region & parameters.
    2. Otherwise ingests (or loads from NoSQL `weather_cache`) daily historical observations.
    3. Cleans data (gaps, outliers, unit normalization).
    4. Runs domain-specific climate hazard detection, OLS linear regression, rolling averages, & Mann-Kendall test.
    5. Stores the computed document in the NoSQL database and returns JSON summaries and plot series.
    """
    t0 = time.perf_counter()
    analysis_key = build_analysis_cache_key(req)

    if not req.force_refresh:
        cached_doc = db.get_hazard_analysis(analysis_key)
        if cached_doc and "data" in cached_doc:
            result = cached_doc["data"]
            result["meta"]["analysis_cache_hit"] = True
            result["meta"]["execution_time_ms"] = round((time.perf_counter() - t0) * 1000.0, 2)
            return result

    try:
        weather_bundle = await ingest_historical_weather(req)
        df, quality_report = clean_and_prepare_weather_dataframe(
            raw_daily=weather_bundle["daily"],
            unit=req.unit,
        )
        hazard_results = run_hazard_detection_and_trends(df=df, req=req)
        summary_insights = generate_climate_insights(
            req=req,
            hazard_results=hazard_results,
            quality_report=quality_report,
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve)) from ve
    except Exception as exc:
        logger.exception("Climate hazard analysis failed")
        raise HTTPException(status_code=500, detail=f"Internal analysis error: {exc}") from exc

    coords = compute_sampling_coordinates(req)
    center_lat = round(sum(c[0] for c in coords) / len(coords), 4)
    center_lon = round(sum(c[1] for c in coords) / len(coords), 4)

    # Exclude full `all_events` list from primary JSON payload if >150 events to keep payload snappy,
    # while keeping `top_events` (top 25) and up to 120 chronological events for scatter/timeline charts
    chronological_events = hazard_results["all_events"][-150:]

    response_payload: Dict[str, Any] = {
        "meta": {
            "analysis_key": analysis_key,
            "weather_cache_key": weather_bundle["cache_key"],
            "weather_cache_hit": weather_bundle["cache_hit"],
            "analysis_cache_hit": False,
            "nosql_engine": db.backend_type,
            "region_mode": req.region_mode.value,
            "region_name": req.region_name,
            "center_coordinates": {"latitude": center_lat, "longitude": center_lon},
            "sampled_coordinates": weather_bundle["coords"],
            "bbox": req.bbox.model_dump() if req.bbox else None,
            "hazard_type": req.hazard_type.value,
            "start_year": req.start_year,
            "end_year": req.end_year,
            "years_analyzed": len(hazard_results["annual_series"]),
            "unit": req.unit.value,
            "temperature_unit_symbol": quality_report["temperature_unit"],
            "data_source": weather_bundle["data_source"],
            "is_live_api": weather_bundle["is_live_api"],
            "elevation_m": weather_bundle["elevation_m"],
            "execution_time_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        },
        "data_quality": quality_report,
        "threshold_info": hazard_results["threshold_info"],
        "summary": summary_insights,
        "trends": hazard_results["trends"],
        "annual_series": hazard_results["annual_series"],
        "monthly_distribution": hazard_results["monthly_distribution"],
        "decadal_summary": hazard_results["decadal_summary"],
        "total_events_detected": hazard_results["total_events_detected"],
        "top_events": hazard_results["top_events"],
        "events_timeline": chronological_events,
    }

    db.save_hazard_analysis(analysis_key, response_payload)
    return response_payload


@app.post("/api/export/csv")
async def export_analysis_csv(req: AnalyzeRequest) -> StreamingResponse:
    """
    Bonus Challenge: Exports the annual climate hazard time-series, regression trends,
    and summary metadata as a clean CSV download.
    """
    result = await analyze_climate_hazard(req)
    output = io.StringIO()
    writer = csv.writer(output)

    meta = result["meta"]
    summary = result["summary"]
    thresh = result["threshold_info"]
    trends = result["trends"]

    writer.writerow(["# Climate Hazard Trend Analyzer - Export Report"])
    writer.writerow(["# Region", meta["region_name"]])
    writer.writerow(["# Coordinates", f"{meta['center_coordinates']['latitude']}, {meta['center_coordinates']['longitude']}"])
    writer.writerow(["# Hazard Type", meta["hazard_type"].upper()])
    writer.writerow(["# Period", f"{meta['start_year']} to {meta['end_year']}"])
    writer.writerow(["# Hazard Rule", thresh["rule_description"]])
    writer.writerow(["# Headline Insight", summary["headline"]])
    writer.writerow(
        [
            "# Frequency Mann-Kendall Test",
            f"Z={trends['frequency']['mann_kendall']['z_score']}, "
            f"p={trends['frequency']['mann_kendall']['p_value']}, "
            f"Direction={trends['frequency']['mann_kendall']['trend_direction']}",
        ]
    )
    writer.writerow([])

    writer.writerow(
        [
            "Year",
            "Event_Count",
            "Freq_Rolling_5Yr",
            "Freq_OLS_Trend",
            "Total_Hazard_Days",
            "Days_Rolling_5Yr",
            "Days_OLS_Trend",
            "Mean_Duration_Days",
            "Max_Duration_Days",
            "Peak_Intensity",
            "Cumulative_Excess_Index",
            "Annual_Mean_Tmax",
            "Annual_Total_Prcp_mm",
        ]
    )

    for row in result["annual_series"]:
        writer.writerow(
            [
                row["year"],
                row["event_count"],
                row["freq_rolling_5yr"] if row["freq_rolling_5yr"] is not None else "",
                row["freq_trend_ols"],
                row["total_hazard_days"],
                row["days_rolling_5yr"] if row["days_rolling_5yr"] is not None else "",
                row["days_trend_ols"],
                row["mean_duration_days"],
                row["max_duration_days"],
                row["peak_intensity"],
                row["cumulative_index"],
                row["annual_mean_tmax"],
                row["annual_total_prcp"],
            ]
        )

    output.seek(0)
    safe_region = "".join(c if c.isalnum() else "_" for c in meta["region_name"]).strip("_")
    filename = f"climate_hazard_{meta['hazard_type']}_{safe_region}_{meta['start_year']}_{meta['end_year']}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

