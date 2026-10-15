from __future__ import annotations

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from backend.data_processor import clean_and_prepare_weather_dataframe
from backend.hazard_engine import mann_kendall_trend_test, ols_linear_regression, run_hazard_detection_and_trends
from backend.main import app
from backend.schemas import AnalyzeRequest, HazardType, RegionMode, TemperatureUnit


def test_data_processor_handles_gaps_outliers_and_units():
    dates = pd.date_range("2020-01-01", periods=30, freq="D").strftime("%Y-%m-%d").tolist()
    tmax = [30.0] * 30
    tmin = [20.0] * 30
    tmean = [25.0] * 30
    prcp = [0.0] * 30

    # Inject a 2-day missing gap (should be linearly interpolated)
    tmax[5] = None
    tmax[6] = None

    # Inject a physical outlier (> 60°C) and an inverted tmin > tmax
    tmax[12] = 95.0
    tmin[15] = 35.0
    tmax[15] = 25.0

    raw_daily = {
        "time": dates,
        "temperature_2m_max": tmax,
        "temperature_2m_min": tmin,
        "temperature_2m_mean": tmean,
        "precipitation_sum": prcp,
    }

    df, report = clean_and_prepare_weather_dataframe(raw_daily, unit=TemperatureUnit.FAHRENHEIT)
    assert len(df) == 30
    assert report["initial_missing_temp_days"] == 2
    assert report["outliers_and_spikes_cleaned"] >= 1
    assert report["inverted_tmin_tmax_fixed"] == 1
    assert report["interpolated_short_gap_days"] >= 2
    assert report["temperature_unit"] == "°F"
    # 30°C in Fahrenheit is 86°F
    assert np.isclose(df.loc[0, "tmax"], 86.0)


def test_mann_kendall_and_ols_detect_monotonic_upward_trend():
    years = np.arange(1990, 2021, dtype=float)
    # Clear upward trend + minor noise
    values = 2.0 + 0.25 * (years - 1990)

    mk = mann_kendall_trend_test(years, values)
    ols = ols_linear_regression(years, values)

    assert mk["significant_at_95"] is True
    assert mk["z_score"] > 3.0
    assert np.isclose(mk["sens_slope_per_year"], 0.25, atol=0.02)
    assert np.isclose(ols["slope_per_year"], 0.25, atol=0.02)
    assert ols["r_squared"] > 0.95


def test_heatwave_streak_detection_95th_percentile():
    dates = pd.date_range("2010-01-01", "2015-12-31", freq="D")
    n = len(dates)
    tmax = np.full(n, 28.0)
    tmin = np.full(n, 18.0)
    tmean = np.full(n, 23.0)
    prcp = np.zeros(n)

    # Inject a 4-day heatwave in 2012 and a 5-day heatwave in 2014
    tmax[800:804] = 43.5
    tmax[1550:1555] = 45.0

    raw_daily = {
        "time": dates.strftime("%Y-%m-%d").tolist(),
        "temperature_2m_max": tmax.tolist(),
        "temperature_2m_min": tmin.tolist(),
        "temperature_2m_mean": tmean.tolist(),
        "precipitation_sum": prcp.tolist(),
    }
    df, _ = clean_and_prepare_weather_dataframe(raw_daily)
    req = AnalyzeRequest(
        region_mode=RegionMode.CITY,
        region_name="Test Region",
        latitude=28.6,
        longitude=77.2,
        hazard_type=HazardType.HEATWAVE,
        start_year=2010,
        end_year=2015,
        percentile_threshold=95.0,
        min_consecutive_days=3,
    )
    res = run_hazard_detection_and_trends(df, req)
    assert res["total_events_detected"] == 2
    durations = sorted([e["duration_days"] for e in res["top_events"]])
    assert durations == [4, 5]


def test_fastapi_endpoints_and_nosql_caching():
    client = TestClient(app)

    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert "X-RateLimit-Limit" in health.headers

    presets = client.get("/api/regions/presets")
    assert presets.status_code == 200
    assert len(presets.json()["presets"]) >= 10

    payload = {
        "region_mode": "city",
        "region_name": "New Delhi, India",
        "latitude": 28.6139,
        "longitude": 77.2090,
        "hazard_type": "heatwave",
        "start_year": 2000,
        "end_year": 2020,
        "percentile_threshold": 95.0,
        "min_consecutive_days": 3,
        "unit": "celsius",
    }
    resp1 = client.post("/api/analyze", json=payload)
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert "summary" in data1
    assert "annual_series" in data1
    assert len(data1["annual_series"]) == 21

    # Second identical call must hit the NoSQL analysis cache
    resp2 = client.post("/api/analyze", json=payload)
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["meta"]["analysis_cache_hit"] is True

    # CSV export endpoint
    csv_resp = client.post("/api/export/csv", json=payload)
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.headers["content-type"]
    assert "Year,Event_Count" in csv_resp.text

