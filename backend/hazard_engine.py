from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from scipy import stats

from backend.schemas import AnalyzeRequest, HazardType


def mann_kendall_trend_test(years: np.ndarray, values: np.ndarray) -> Dict[str, Any]:
    """
    Performs the non-parametric Mann-Kendall monotonic trend test and computes
    the Theil-Sen robust median slope estimator.
    """
    mask = np.isfinite(values)
    x = years[mask].astype(float)
    y = values[mask].astype(float)
    n = len(y)

    if n < 4:
        return {
            "s_statistic": 0.0,
            "z_score": 0.0,
            "tau": 0.0,
            "p_value": 1.0,
            "sens_slope_per_year": 0.0,
            "sens_slope_per_decade": 0.0,
            "significant_at_95": False,
            "significant_at_90": False,
            "trend_direction": "insufficient_data",
            "interpretation": "Insufficient annual data points (< 4 years) for Mann-Kendall test.",
        }

    # Compute S statistic
    s = 0
    slopes: List[float] = []
    for i in range(n - 1):
        diffs = y[i + 1 :] - y[i]
        dt = x[i + 1 :] - x[i]
        s += int(np.sum(np.sign(diffs)))
        valid_dt = dt != 0
        slopes.extend((diffs[valid_dt] / dt[valid_dt]).tolist())

    # Variance with tie correction
    _, tie_counts = np.unique(y, return_counts=True)
    tie_term = np.sum(tie_counts * (tie_counts - 1) * (2 * tie_counts + 5))
    var_s = (n * (n - 1) * (2 * n + 5) - tie_term) / 18.0

    if var_s <= 0:
        z = 0.0
    elif s > 0:
        z = (s - 1.0) / np.sqrt(var_s)
    elif s < 0:
        z = (s + 1.0) / np.sqrt(var_s)
    else:
        z = 0.0

    p_val = float(2.0 * (1.0 - stats.norm.cdf(abs(z))))
    denom = 0.5 * n * (n - 1)
    tau = float(s / denom) if denom > 0 else 0.0
    sens_slope = float(np.median(slopes)) if slopes else 0.0

    sig_95 = p_val < 0.05
    sig_90 = p_val < 0.10

    if sig_95 and z > 0:
        direction = "Significantly Increasing (p < 0.05)"
    elif sig_95 and z < 0:
        direction = "Significantly Decreasing (p < 0.05)"
    elif sig_90 and z > 0:
        direction = "Moderately Increasing (p < 0.10)"
    elif sig_90 and z < 0:
        direction = "Moderately Decreasing (p < 0.10)"
    elif z > 0.5:
        direction = "Upward Tendency (Not Statistically Significant)"
    elif z < -0.5:
        direction = "Downward Tendency (Not Statistically Significant)"
    else:
        direction = "No Statistically Significant Monotonic Trend"

    return {
        "s_statistic": int(s),
        "z_score": round(float(z), 3),
        "tau": round(tau, 3),
        "p_value": round(p_val, 4),
        "sens_slope_per_year": round(sens_slope, 4),
        "sens_slope_per_decade": round(sens_slope * 10.0, 3),
        "significant_at_95": bool(sig_95),
        "significant_at_90": bool(sig_90),
        "trend_direction": direction,
    }


def ols_linear_regression(years: np.ndarray, values: np.ndarray) -> Dict[str, Any]:
    """
    Computes Ordinary Least Squares (OLS) linear regression trend over time,
    returning slope per year, slope per decade, R^2, p-value, and fitted line values.
    """
    mask = np.isfinite(values)
    x = years[mask].astype(float)
    y = values[mask].astype(float)

    if len(x) < 2 or np.all(y == y[0]):
        fitted = [round(float(v), 2) if np.isfinite(v) else 0.0 for v in values]
        return {
            "slope_per_year": 0.0,
            "slope_per_decade": 0.0,
            "intercept": float(y[0]) if len(y) > 0 else 0.0,
            "r_squared": 0.0,
            "p_value": 1.0,
            "std_err": 0.0,
            "fitted_values": fitted,
        }

    res = stats.linregress(x, y)
    slope = float(res.slope)
    intercept = float(res.intercept)
    r_sq = float(res.rvalue**2)
    p_val = float(res.pvalue)
    std_err = float(res.stderr)

    fitted = [round(slope * float(yr) + intercept, 3) for yr in years]

    return {
        "slope_per_year": round(slope, 4),
        "slope_per_decade": round(slope * 10.0, 3),
        "intercept": round(intercept, 3),
        "r_squared": round(r_sq, 4),
        "p_value": round(p_val, 4),
        "std_err": round(std_err, 4),
        "fitted_values": fitted,
    }


def compute_rolling_averages(values: List[float], window: int = 5) -> List[Optional[float]]:
    s = pd.Series(values, dtype="float64")
    rolled = s.rolling(window=window, min_periods=max(2, window // 2)).mean()
    return [round(float(v), 2) if pd.notna(v) else None for v in rolled]


def _extract_contiguous_events(
    df: pd.DataFrame,
    exceed_mask: pd.Series,
    value_col: str,
    threshold_series: pd.Series,
    min_consecutive_days: int,
    hazard_type: HazardType,
) -> List[Dict[str, Any]]:
    """
    Identifies contiguous runs of `exceed_mask == True` lasting at least `min_consecutive_days`.
    """
    events: List[Dict[str, Any]] = []
    in_streak = False
    start_idx = 0

    mask_arr = exceed_mask.to_numpy(dtype=bool)
    n = len(mask_arr)

    for i in range(n + 1):
        is_hot = mask_arr[i] if i < n else False
        if is_hot and not in_streak:
            in_streak = True
            start_idx = i
        elif not is_hot and in_streak:
            in_streak = False
            duration = i - start_idx
            if duration >= min_consecutive_days:
                sub = df.iloc[start_idx:i]
                sub_thresh = threshold_series.iloc[start_idx:i]
                vals = sub[value_col].to_numpy(dtype=float)
                thresh_vals = sub_thresh.to_numpy(dtype=float)

                if hazard_type == HazardType.DROUGHT:
                    excess = np.maximum(0.0, thresh_vals - vals)
                    peak_val = float(np.min(vals))
                else:
                    excess = np.maximum(0.0, vals - thresh_vals)
                    peak_val = float(np.max(vals))

                mean_val = float(np.mean(vals))
                cum_excess = float(np.sum(excess))
                mean_excess = float(np.mean(excess))

                # Classify event severity
                if duration >= min_consecutive_days * 2 + 2 or mean_excess > 3.5:
                    severity = "Extreme"
                elif duration >= min_consecutive_days + 2 or mean_excess > 1.8:
                    severity = "Severe"
                else:
                    severity = "Moderate"

                start_dt = sub["date"].iloc[0]
                end_dt = sub["date"].iloc[-1]

                events.append(
                    {
                        "event_id": f"{hazard_type.value}-{start_dt.strftime('%Y%m%d')}",
                        "start_date": start_dt.strftime("%Y-%m-%d"),
                        "end_date": end_dt.strftime("%Y-%m-%d"),
                        "year": int(start_dt.year),
                        "month": int(start_dt.month),
                        "duration_days": int(duration),
                        "peak_value": round(peak_val, 2),
                        "mean_value": round(mean_val, 2),
                        "threshold_ref": round(float(np.mean(thresh_vals)), 2),
                        "mean_excess": round(mean_excess, 2),
                        "cumulative_excess": round(cum_excess, 2),
                        "severity": severity,
                    }
                )

    return events


def run_hazard_detection_and_trends(
    df: pd.DataFrame,
    req: AnalyzeRequest,
) -> Dict[str, Any]:
    """
    Executes domain-specific climate hazard detection (Heatwave, Heavy Rainfall, or Drought),
    aggregates annual and monthly series, and computes OLS regression, rolling averages,
    and Mann-Kendall non-parametric trend tests.
    """
    years_all = sorted(df["year"].unique().tolist())
    n_years = len(years_all)

    # Establish climatological reference baseline (first half of selected period, up to 15 years, or full period)
    baseline_span = min(max(10, n_years // 2), 20)
    baseline_end_year = years_all[min(baseline_span - 1, n_years - 1)]
    baseline_df = df[df["year"] <= baseline_end_year]
    if len(baseline_df) < 365 * 3:
        baseline_df = df

    hazard = req.hazard_type
    pct = req.percentile_threshold
    min_days = req.min_consecutive_days

    if hazard == HazardType.HEATWAVE:
        value_col = "tmax"
        # Fixed regional percentile vs Dynamic 15-day rolling calendar percentile
        static_threshold = float(np.nanpercentile(baseline_df["tmax"].dropna(), pct))
        full_period_threshold = float(np.nanpercentile(df["tmax"].dropna(), pct))

        if req.use_dynamic_calendar_percentile:
            # Compute day-of-year 15-day window percentile across baseline
            doy_thresh: Dict[int, float] = {}
            base_valid = baseline_df.dropna(subset=["tmax"])
            for doy in range(1, 367):
                window_doys = [((doy - 1 + offset) % 365) + 1 for offset in range(-7, 8)]
                sub_vals = base_valid.loc[base_valid["doy"].isin(window_doys), "tmax"]
                doy_thresh[doy] = float(np.nanpercentile(sub_vals, pct)) if len(sub_vals) > 10 else static_threshold
            # Restrict dynamic heatwaves to warm half of year (above median annual temperature)
            warm_floor = float(np.nanpercentile(baseline_df["tmax"].dropna(), 65.0))
            threshold_series = df["doy"].map(lambda d: max(doy_thresh.get(int(d), static_threshold), warm_floor))
            rule_description = (
                f"{min_days}+ consecutive days where daily Tmax exceeds the warm-season 15-day "
                f"calendar {pct:.0f}th percentile (mean threshold: { float(threshold_series.mean()):.1f}°)."
            )
            primary_threshold_value = round(float(threshold_series.mean()), 2)
        else:
            threshold_series = pd.Series(static_threshold, index=df.index, dtype="float64")
            rule_description = (
                f"{min_days}+ consecutive days with daily maximum temperature (Tmax) above the "
                f"{pct:.0f}th percentile ({static_threshold:.2f}°) for that region."
            )
            primary_threshold_value = round(static_threshold, 2)

        exceed_mask = df["tmax"].notna() & (df["tmax"] > threshold_series)

    elif hazard == HazardType.HEAVY_RAINFALL:
        value_col = "prcp"
        # WMO R95p standard: percentile calculated over wet days (PRCP >= 1.0 mm) in baseline
        wet_baseline = baseline_df.loc[baseline_df["prcp"] >= 1.0, "prcp"]
        if len(wet_baseline) >= 30:
            static_threshold = float(np.nanpercentile(wet_baseline, pct))
        else:
            static_threshold = float(np.nanpercentile(baseline_df["prcp"].dropna(), max(pct, 95.0)))
        static_threshold = max(static_threshold, 10.0)  # At least 10mm/day to count as heavy rain
        full_period_threshold = static_threshold

        # For heavy rainfall, if user left default min_consecutive_days=3 from heatwave,
        # use 1+ day for heavy downpours unless explicitly set otherwise, or use min(req.min_consecutive_days, 2)
        effective_min_days = 1 if req.min_consecutive_days == 3 else req.min_consecutive_days
        min_days = effective_min_days
        threshold_series = pd.Series(static_threshold, index=df.index, dtype="float64")
        exceed_mask = df["prcp"].notna() & (df["prcp"] > threshold_series)
        primary_threshold_value = round(static_threshold, 2)
        rule_description = (
            f"{min_days}+ consecutive day(s) with daily precipitation exceeding the wet-day "
            f"{pct:.0f}th percentile ({static_threshold:.1f} mm/day, WMO R{pct:.0f}p standard)."
        )

    else:  # DROUGHT (Meteorological Dry Spells + Rainfall Deficit)
        value_col = "prcp"
        dry_day_cutoff = 1.0  # WMO standard dry day < 1.0 mm
        # Consecutive dry day streak threshold: at least 14 consecutive dry days (or user custom >= 7)
        min_days = max(14, req.min_consecutive_days * 4) if req.min_consecutive_days <= 5 else req.min_consecutive_days
        static_threshold = dry_day_cutoff
        full_period_threshold = dry_day_cutoff
        threshold_series = pd.Series(dry_day_cutoff, index=df.index, dtype="float64")
        exceed_mask = df["prcp"].notna() & (df["prcp"] < dry_day_cutoff)
        primary_threshold_value = dry_day_cutoff
        rule_description = (
            f"Prolonged meteorological dry spells of {min_days}+ consecutive dry days "
            f"(daily precipitation < {dry_day_cutoff:.1f} mm, WMO CDD standard)."
        )

    # Extract all discrete events across the historical period
    events = _extract_contiguous_events(
        df=df,
        exceed_mask=exceed_mask,
        value_col=value_col,
        threshold_series=threshold_series,
        min_consecutive_days=min_days,
        hazard_type=hazard,
    )

    # Group events by year to construct comprehensive annual time-series metrics
    events_by_year: Dict[int, List[Dict[str, Any]]] = {yr: [] for yr in years_all}
    for ev in events:
        yr = ev["year"]
        if yr in events_by_year:
            events_by_year[yr].append(ev)

    annual_series: List[Dict[str, Any]] = []
    for yr in years_all:
        yr_df = df[df["year"] == yr]
        yr_events = events_by_year.get(yr, [])

        event_count = len(yr_events)
        total_hazard_days = sum(e["duration_days"] for e in yr_events)
        mean_duration = round(total_hazard_days / event_count, 2) if event_count > 0 else 0.0
        max_duration = max((e["duration_days"] for e in yr_events), default=0)

        if hazard == HazardType.HEATWAVE:
            peak_intensity = round(
                max((e["peak_value"] for e in yr_events), default=float(yr_df["tmax"].max())),
                2,
            )
            cumulative_excess = round(sum(e["cumulative_excess"] for e in yr_events), 2)
            mean_excess = round(
                float(np.mean([e["mean_excess"] for e in yr_events])) if yr_events else 0.0,
                2,
            )
        elif hazard == HazardType.HEAVY_RAINFALL:
            peak_intensity = round(float(yr_df["prcp"].max()), 2)  # Rx1day
            cumulative_excess = round(sum(e["peak_value"] for e in yr_events), 2)
            mean_excess = round(
                float(np.mean([e["mean_excess"] for e in yr_events])) if yr_events else 0.0,
                2,
            )
        else:  # DROUGHT
            # For drought, peak intensity is longest dry spell (CDD) or annual deficit
            peak_intensity = float(max_duration)
            annual_prcp = float(yr_df["prcp"].sum())
            cumulative_excess = round(annual_prcp, 1)
            mean_excess = round(mean_duration, 2)

        annual_series.append(
            {
                "year": int(yr),
                "event_count": int(event_count),
                "total_hazard_days": int(total_hazard_days),
                "mean_duration_days": float(mean_duration),
                "max_duration_days": int(max_duration),
                "peak_intensity": float(peak_intensity) if np.isfinite(peak_intensity) else 0.0,
                "mean_excess": float(mean_excess),
                "cumulative_index": float(cumulative_excess),
                "annual_mean_tmax": round(float(yr_df["tmax"].mean()), 2) if yr_df["tmax"].notna().any() else 0.0,
                "annual_max_tmax": round(float(yr_df["tmax"].max()), 2) if yr_df["tmax"].notna().any() else 0.0,
                "annual_total_prcp": round(float(yr_df["prcp"].sum()), 1),
            }
        )

    years_arr = np.array([row["year"] for row in annual_series], dtype=float)
    freq_arr = np.array([row["event_count"] for row in annual_series], dtype=float)
    days_arr = np.array([row["total_hazard_days"] for row in annual_series], dtype=float)
    dur_arr = np.array([row["mean_duration_days"] for row in annual_series], dtype=float)
    peak_arr = np.array([row["peak_intensity"] for row in annual_series], dtype=float)
    mean_tmax_arr = np.array([row["annual_mean_tmax"] for row in annual_series], dtype=float)

    # Compute OLS Linear Regressions & Mann-Kendall tests for key metrics
    freq_ols = ols_linear_regression(years_arr, freq_arr)
    days_ols = ols_linear_regression(years_arr, days_arr)
    dur_ols = ols_linear_regression(years_arr, dur_arr)
    peak_ols = ols_linear_regression(years_arr, peak_arr)
    tmax_ols = ols_linear_regression(years_arr, mean_tmax_arr)

    freq_mk = mann_kendall_trend_test(years_arr, freq_arr)
    days_mk = mann_kendall_trend_test(years_arr, days_arr)
    dur_mk = mann_kendall_trend_test(years_arr, dur_arr)
    peak_mk = mann_kendall_trend_test(years_arr, peak_arr)

    # Enrich annual_series with rolling averages (5-yr and 10-yr) and regression trendlines
    freq_roll5 = compute_rolling_averages(freq_arr.tolist(), window=5)
    freq_roll10 = compute_rolling_averages(freq_arr.tolist(), window=10)
    days_roll5 = compute_rolling_averages(days_arr.tolist(), window=5)
    dur_roll5 = compute_rolling_averages(dur_arr.tolist(), window=5)
    peak_roll5 = compute_rolling_averages(peak_arr.tolist(), window=5)

    for idx, row in enumerate(annual_series):
        row["freq_rolling_5yr"] = freq_roll5[idx]
        row["freq_rolling_10yr"] = freq_roll10[idx]
        row["freq_trend_ols"] = freq_ols["fitted_values"][idx]
        row["days_rolling_5yr"] = days_roll5[idx]
        row["days_trend_ols"] = days_ols["fitted_values"][idx]
        row["duration_rolling_5yr"] = dur_roll5[idx]
        row["duration_trend_ols"] = dur_ols["fitted_values"][idx]
        row["peak_rolling_5yr"] = peak_roll5[idx]
        row["peak_trend_ols"] = peak_ols["fitted_values"][idx]

    # Monthly seasonality distribution (Jan=1 .. Dec=12)
    month_names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly_counts = {m: 0 for m in range(1, 13)}
    monthly_days = {m: 0 for m in range(1, 13)}
    for ev in events:
        m = ev["month"]
        monthly_counts[m] = monthly_counts.get(m, 0) + 1
        monthly_days[m] = monthly_days.get(m, 0) + ev["duration_days"]

    monthly_distribution = [
        {
            "month": m,
            "month_name": month_names[m - 1],
            "event_count": monthly_counts[m],
            "total_hazard_days": monthly_days[m],
        }
        for m in range(1, 13)
    ]

    # Decadal breakdown (e.g. 1990s, 2000s, 2010s, 2020s)
    decades: Dict[str, List[Dict[str, Any]]] = {}
    for row in annual_series:
        dec_start = (row["year"] // 10) * 10
        dec_label = f"{dec_start}s"
        decades.setdefault(dec_label, []).append(row)

    decadal_summary = []
    for dec_label, rows in decades.items():
        decadal_summary.append(
            {
                "decade": dec_label,
                "years_covered": f"{rows[0]['year']}–{rows[-1]['year']}",
                "year_count": len(rows),
                "avg_events_per_year": round(float(np.mean([r["event_count"] for r in rows])), 2),
                "avg_hazard_days_per_year": round(float(np.mean([r["total_hazard_days"] for r in rows])), 2),
                "avg_duration_days": round(float(np.mean([r["mean_duration_days"] for r in rows])), 2),
                "max_peak_intensity": round(float(np.max([r["peak_intensity"] for r in rows])), 2),
            }
        )

    # Sort top 25 most severe / longest events for table inspection & export
    top_events = sorted(
        events,
        key=lambda e: (e["duration_days"], e["cumulative_excess"], e["peak_value"]),
        reverse=True,
    )[:25]

    return {
        "threshold_info": {
            "percentile": pct,
            "min_consecutive_days": min_days,
            "primary_threshold_value": primary_threshold_value,
            "full_period_percentile_value": round(full_period_threshold, 2),
            "baseline_period": f"{years_all[0]}–{baseline_end_year}",
            "use_dynamic_calendar_percentile": req.use_dynamic_calendar_percentile,
            "rule_description": rule_description,
        },
        "annual_series": annual_series,
        "monthly_distribution": monthly_distribution,
        "decadal_summary": decadal_summary,
        "trends": {
            "frequency": {
                "ols": freq_ols,
                "mann_kendall": freq_mk,
            },
            "total_hazard_days": {
                "ols": days_ols,
                "mann_kendall": days_mk,
            },
            "duration": {
                "ols": dur_ols,
                "mann_kendall": dur_mk,
            },
            "peak_intensity": {
                "ols": peak_ols,
                "mann_kendall": peak_mk,
            },
            "background_warming": {
                "ols": tmax_ols,
            },
        },
        "total_events_detected": len(events),
        "top_events": top_events,
        "all_events": events,
    }

