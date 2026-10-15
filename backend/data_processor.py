from __future__ import annotations

from typing import Any, Dict, Tuple

import numpy as np
import pandas as pd

from backend.schemas import TemperatureUnit


def clean_and_prepare_weather_dataframe(
    raw_daily: Dict[str, Any],
    unit: TemperatureUnit = TemperatureUnit.CELSIUS,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """
    Cleans, validates, interpolates short gaps, screens telemetry outliers, and normalizes units
    for daily historical weather observations.
    Returns:
      - Cleaned pandas DataFrame with columns:
        ['date', 'year', 'month', 'doy', 'tmax', 'tmin', 'tmean', 'prcp', 'is_interpolated', 'is_outlier_cleaned']
      - Data Quality Report dictionary for transparency in API & UI.
    """
    dates = pd.to_datetime(raw_daily.get("time", []))
    if len(dates) == 0:
        raise ValueError("Empty daily time series received from weather source.")

    n = len(dates)
    tmax_raw = pd.Series(raw_daily.get("temperature_2m_max", [np.nan] * n), dtype="float64")
    tmin_raw = pd.Series(raw_daily.get("temperature_2m_min", [np.nan] * n), dtype="float64")
    tmean_raw = pd.Series(raw_daily.get("temperature_2m_mean", [np.nan] * n), dtype="float64")
    prcp_raw = pd.Series(raw_daily.get("precipitation_sum", [np.nan] * n), dtype="float64")

    df = pd.DataFrame(
        {
            "date": dates,
            "tmax": tmax_raw,
            "tmin": tmin_raw,
            "tmean": tmean_raw,
            "prcp": prcp_raw,
        }
    ).sort_values("date")

    # Deduplicate any duplicate timestamps and reindex to a continuous daily calendar grid
    df = df.drop_duplicates(subset=["date"], keep="first").set_index("date")
    full_date_index = pd.date_range(start=df.index.min(), end=df.index.max(), freq="D")
    calendar_gaps_added = int(len(full_date_index) - len(df))
    df = df.reindex(full_date_index)
    df.index.name = "date"
    df = df.reset_index()

    total_days = int(len(df))
    initial_missing_tmax = int(df["tmax"].isna().sum())
    initial_missing_prcp = int(df["prcp"].isna().sum())

    # 1. Physical bounds check (WMO global surface observation limits)
    physical_outliers_tmax = (df["tmax"] < -85.0) | (df["tmax"] > 60.0)
    physical_outliers_tmin = (df["tmin"] < -90.0) | (df["tmin"] > 55.0)
    physical_outliers_prcp = (df["prcp"] < 0.0) | (df["prcp"] > 1850.0)

    df.loc[physical_outliers_tmax, "tmax"] = np.nan
    df.loc[physical_outliers_tmin, "tmin"] = np.nan
    df.loc[physical_outliers_prcp, "prcp"] = np.nan

    # 2. Internal consistency check: swap tmin and tmax if inverted due to station logging error
    inverted_mask = df["tmin"].notna() & df["tmax"].notna() & (df["tmin"] > df["tmax"])
    inverted_count = int(inverted_mask.sum())
    if inverted_count > 0:
        df.loc[inverted_mask, ["tmin", "tmax"]] = df.loc[inverted_mask, ["tmax", "tmin"]].values

    # 3. Single-day telemetry spike detection using 15-day rolling Median Absolute Deviation (MAD)
    # Only flags isolated 1-day spikes that deviate by > 6*MAD AND jump > 16°C from both adjacent days
    rolling_med = df["tmax"].rolling(window=15, center=True, min_periods=5).median()
    abs_dev = (df["tmax"] - rolling_med).abs()
    rolling_mad = abs_dev.rolling(window=15, center=True, min_periods=5).median().clip(lower=1.2)
    prev_diff = (df["tmax"] - df["tmax"].shift(1)).abs()
    next_diff = (df["tmax"] - df["tmax"].shift(-1)).abs()

    spike_mask = (abs_dev > 6.5 * rolling_mad) & (prev_diff > 16.0) & (next_diff > 16.0)
    spike_count = int(spike_mask.sum())
    df["is_outlier_cleaned"] = physical_outliers_tmax | physical_outliers_prcp | spike_mask
    if spike_count > 0:
        df.loc[spike_mask, "tmax"] = rolling_med[spike_mask]

    outliers_cleaned_total = int(df["is_outlier_cleaned"].sum())

    # 4. Gap interpolation: linearly interpolate short gaps (<= 3 consecutive days)
    missing_before_interp = df["tmax"].isna()
    df["tmax"] = df["tmax"].interpolate(method="linear", limit=3, limit_area="inside")
    df["tmin"] = df["tmin"].interpolate(method="linear", limit=3, limit_area="inside")
    df["tmean"] = df["tmean"].fillna((df["tmax"] + df["tmin"]) / 2.0)
    df["tmean"] = df["tmean"].interpolate(method="linear", limit=3, limit_area="inside")

    df["is_interpolated"] = missing_before_interp & df["tmax"].notna()
    interpolated_days = int(df["is_interpolated"].sum())
    unfilled_gap_days = int(df["tmax"].isna().sum())

    # Fill missing precipitation conservatively with 0.0 mm
    df["prcp"] = df["prcp"].fillna(0.0).clip(lower=0.0)

    # 5. Unit Normalization (Internal computation happens in requested temperature unit or metric)
    temp_unit_symbol = "°C"
    if unit == TemperatureUnit.FAHRENHEIT:
        temp_unit_symbol = "°F"
        for col in ["tmax", "tmin", "tmean"]:
            df[col] = df[col] * 1.8 + 32.0

    for col in ["tmax", "tmin", "tmean", "prcp"]:
        df[col] = df[col].round(2)

    df["year"] = df["date"].dt.year
    df["month"] = df["date"].dt.month
    df["doy"] = df["date"].dt.dayofyear

    completeness_pct = round(100.0 * (total_days - initial_missing_tmax) / max(total_days, 1), 2)

    quality_report = {
        "total_days_in_span": total_days,
        "calendar_gaps_reindexed": calendar_gaps_added,
        "initial_missing_temp_days": initial_missing_tmax,
        "initial_missing_prcp_days": initial_missing_prcp,
        "interpolated_short_gap_days": interpolated_days,
        "unfilled_long_gap_days": unfilled_gap_days,
        "outliers_and_spikes_cleaned": outliers_cleaned_total,
        "inverted_tmin_tmax_fixed": inverted_count,
        "raw_completeness_pct": completeness_pct,
        "usable_completeness_pct": round(100.0 * (total_days - unfilled_gap_days) / max(total_days, 1), 2),
        "temperature_unit": temp_unit_symbol,
        "precipitation_unit": "mm",
        "cleaning_methodology": (
            "Continuous daily re-indexing, WMO physical range filtering, 15-day MAD telemetry spike "
            "screening, and linear interpolation for gaps <= 3 consecutive days."
        ),
    }

    return df, quality_report

