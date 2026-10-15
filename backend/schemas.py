from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class HazardType(str, Enum):
    HEATWAVE = "heatwave"
    HEAVY_RAINFALL = "heavy_rainfall"
    DROUGHT = "drought"


class RegionMode(str, Enum):
    CITY = "city"
    STATE = "state"
    BBOX = "bbox"
    POINT = "point"


class TemperatureUnit(str, Enum):
    CELSIUS = "celsius"
    FAHRENHEIT = "fahrenheit"


class BoundingBox(BaseModel):
    min_lat: float = Field(..., ge=-90.0, le=90.0, description="Southern latitude boundary")
    max_lat: float = Field(..., ge=-90.0, le=90.0, description="Northern latitude boundary")
    min_lon: float = Field(..., ge=-180.0, le=180.0, description="Western longitude boundary")
    max_lon: float = Field(..., ge=-180.0, le=180.0, description="Eastern longitude boundary")

    @model_validator(mode="after")
    def validate_box(self) -> "BoundingBox":
        if self.min_lat > self.max_lat:
            raise ValueError("min_lat must be less than or equal to max_lat")
        if self.min_lon > self.max_lon:
            raise ValueError("min_lon must be less than or equal to max_lon")
        lat_span = self.max_lat - self.min_lat
        lon_span = self.max_lon - self.min_lon
        if lat_span > 25.0 or lon_span > 25.0:
            raise ValueError(
                "Bounding box span cannot exceed 25 degrees in latitude or longitude "
                "to ensure regional климатическая homogeneity and protect external API quotas."
            )
        return self


class AnalyzeRequest(BaseModel):
    region_mode: RegionMode = Field(default=RegionMode.CITY, description="How the region is specified")
    region_name: str = Field(
        default="New Delhi, India",
        min_length=1,
        max_length=120,
        description="Human-readable region label",
    )
    latitude: Optional[float] = Field(default=28.6139, ge=-90.0, le=90.0)
    longitude: Optional[float] = Field(default=77.2090, ge=-180.0, le=180.0)
    bbox: Optional[BoundingBox] = Field(default=None, description="Custom lat-lon bounding box")
    hazard_type: HazardType = Field(default=HazardType.HEATWAVE, description="Climate hazard type to analyze")
    start_year: int = Field(default=1990, ge=1940, le=2025, description="Start year (inclusive)")
    end_year: int = Field(default=2024, ge=1940, le=2025, description="End year (inclusive)")
    percentile_threshold: float = Field(
        default=95.0,
        ge=70.0,
        le=99.5,
        description="Percentile threshold for extreme hazard detection (e.g. 95th percentile)",
    )
    min_consecutive_days: int = Field(
        default=3,
        ge=1,
        le=30,
        description="Minimum consecutive days to qualify as an event (e.g. 3+ days for heatwave)",
    )
    unit: TemperatureUnit = Field(default=TemperatureUnit.CELSIUS, description="Temperature display unit")
    use_dynamic_calendar_percentile: bool = Field(
        default=False,
        description="If True, uses a 15-day rolling calendar-day percentile instead of a fixed regional percentile",
    )
    force_refresh: bool = Field(default=False, description="Bypass cached analysis if True")

    @field_validator("region_name")
    @classmethod
    def sanitize_region_name(cls, v: str) -> str:
        cleaned = re.sub(r"[<>\"'$;{}]", "", v).strip()
        if not cleaned:
            raise ValueError("Region name cannot be empty after sanitization")
        return cleaned

    @model_validator(mode="after")
    def validate_request_consistency(self) -> "AnalyzeRequest":
        if self.end_year < self.start_year:
            raise ValueError("end_year must be greater than or equal to start_year")
        if (self.end_year - self.start_year) < 4:
            raise ValueError("Please select a time range of at least 5 years (e.g. 1990–2020) for meaningful trend analysis")
        if self.region_mode == RegionMode.BBOX:
            if self.bbox is None:
                raise ValueError("bbox coordinates are required when region_mode is 'bbox'")
        else:
            if self.latitude is None or self.longitude is None:
                raise ValueError("latitude and longitude are required when region_mode is not 'bbox'")
        return self


class GeocodeQuery(BaseModel):
    q: str = Field(..., min_length=2, max_length=100)

    @field_validator("q")
    @classmethod
    def sanitize_query(cls, v: str) -> str:
        cleaned = re.sub(r"[<>\"'$;{}]", "", v).strip()
        if len(cleaned) < 2:
            raise ValueError("Search query must be at least 2 valid characters")
        return cleaned

