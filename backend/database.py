from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from tinydb import Query, TinyDB

logger = logging.getLogger("climate_analyzer.db")

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DEFAULT_TINYDB_PATH = DATA_DIR / "climate_nosql_db.json"


class NoSQLDatabase:
    """
    Dual-mode NoSQL Document Database abstraction.
    - Uses MongoDB (via pymongo) if MONGODB_URI is configured and reachable.
    - Uses TinyDB (embedded JSON document store) by default for zero-config reliability.
    Stores two primary document collections:
      1. `weather_cache`   : Raw & cleaned historical daily weather observations.
      2. `hazard_analyses` : Computed climate hazard events, trend lines, and JSON summaries.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.backend_type = "tinydb"
        self._mongo_client = None
        self._mongo_db = None
        self._tinydb: Optional[TinyDB] = None

        self._mem_weather: Dict[str, Dict[str, Any]] = {}
        self._mem_analysis: Dict[str, Dict[str, Any]] = {}
        mongo_uri = os.getenv("MONGODB_URI", "").strip()
        if mongo_uri:
            try:
                from pymongo import MongoClient

                client = MongoClient(mongo_uri, serverSelectionTimeoutMS=3000)
                client.admin.command("ping")
                db_name = os.getenv("MONGODB_DB_NAME", "climate_hazard_analyzer")
                self._mongo_client = client
                self._mongo_db = client[db_name]
                self._mongo_db["weather_cache"].create_index("cache_key", unique=True)
                self._mongo_db["hazard_analyses"].create_index("analysis_key", unique=True)
                self.backend_type = "mongodb"
                logger.info("Connected to MongoDB NoSQL database (%s)", db_name)
            except Exception as exc:
                logger.warning("MongoDB connection failed (%s); falling back to TinyDB NoSQL store.", exc)
                self._init_tinydb()
        else:
            self._init_tinydb()

    def _init_tinydb(self) -> None:
        db_path = Path(os.getenv("TINYDB_PATH", str(DEFAULT_TINYDB_PATH)))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # Use compact JSON formatting for fast read/write without multi-second indentation overhead
        self._tinydb = TinyDB(str(db_path))
        self.backend_type = "tinydb"
        logger.info("Initialized TinyDB NoSQL document database at %s", db_path)

    # ------------------------------------------------------------------
    # Weather Series Cache Collection (`weather_cache`)
    # ------------------------------------------------------------------
    def get_weather_cache(self, cache_key: str, max_age_seconds: int = 86400 * 30) -> Optional[Dict[str, Any]]:
        with self._lock:
            now = time.time()
            if cache_key in self._mem_weather:
                doc = self._mem_weather[cache_key]
                if now - doc.get("created_ts", 0) <= max_age_seconds:
                    return doc

            if self.backend_type == "mongodb" and self._mongo_db is not None:
                doc = self._mongo_db["weather_cache"].find_one({"cache_key": cache_key}, {"_id": 0})
            else:
                assert self._tinydb is not None
                table = self._tinydb.table("weather_cache")
                q = Query()
                res = table.search(q.cache_key == cache_key)
                doc = res[0] if res else None

            if not doc:
                return None

            created_ts = doc.get("created_ts", 0)
            if now - created_ts > max_age_seconds:
                return None
            self._mem_weather[cache_key] = doc
            return doc

    def save_weather_cache(self, cache_key: str, payload: Dict[str, Any]) -> None:
        doc = {
            "cache_key": cache_key,
            "created_ts": time.time(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        with self._lock:
            self._mem_weather[cache_key] = doc
            if self.backend_type == "mongodb" and self._mongo_db is not None:
                self._mongo_db["weather_cache"].update_one(
                    {"cache_key": cache_key},
                    {"$set": doc},
                    upsert=True,
                )
            else:
                assert self._tinydb is not None
                table = self._tinydb.table("weather_cache")
                q = Query()
                table.upsert(doc, q.cache_key == cache_key)

    # ------------------------------------------------------------------
    # Computed Hazard Analysis Collection (`hazard_analyses`)
    # ------------------------------------------------------------------
    def get_hazard_analysis(self, analysis_key: str, max_age_seconds: int = 86400 * 7) -> Optional[Dict[str, Any]]:
        with self._lock:
            now = time.time()
            if analysis_key in self._mem_analysis:
                doc = self._mem_analysis[analysis_key]
                if now - doc.get("created_ts", 0) <= max_age_seconds:
                    return doc

            if self.backend_type == "mongodb" and self._mongo_db is not None:
                doc = self._mongo_db["hazard_analyses"].find_one({"analysis_key": analysis_key}, {"_id": 0})
            else:
                assert self._tinydb is not None
                table = self._tinydb.table("hazard_analyses")
                q = Query()
                res = table.search(q.analysis_key == analysis_key)
                doc = res[0] if res else None

            if not doc:
                return None

            created_ts = doc.get("created_ts", 0)
            if now - created_ts > max_age_seconds:
                return None
            self._mem_analysis[analysis_key] = doc
            return doc

    def save_hazard_analysis(self, analysis_key: str, result_doc: Dict[str, Any]) -> None:
        doc = {
            "analysis_key": analysis_key,
            "created_ts": time.time(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "data": result_doc,
        }
        with self._lock:
            self._mem_analysis[analysis_key] = doc
            if self.backend_type == "mongodb" and self._mongo_db is not None:
                self._mongo_db["hazard_analyses"].update_one(
                    {"analysis_key": analysis_key},
                    {"$set": doc},
                    upsert=True,
                )
            else:
                assert self._tinydb is not None
                table = self._tinydb.table("hazard_analyses")
                q = Query()
                table.upsert(doc, q.analysis_key == analysis_key)

    def get_recent_analyses(self, limit: int = 10) -> List[Dict[str, Any]]:
        with self._lock:
            if self.backend_type == "mongodb" and self._mongo_db is not None:
                cursor = (
                    self._mongo_db["hazard_analyses"]
                    .find(
                        {},
                        {
                            "_id": 0,
                            "analysis_key": 1,
                            "updated_at": 1,
                            "data.meta": 1,
                            "data.summary.headline": 1,
                        },
                    )
                    .sort("created_ts", -1)
                    .limit(limit)
                )
                items = list(cursor)
            else:
                assert self._tinydb is not None
                table = self._tinydb.table("hazard_analyses")
                all_docs = sorted(table.all(), key=lambda d: d.get("created_ts", 0), reverse=True)[:limit]
                items = [
                    {
                        "analysis_key": d.get("analysis_key"),
                        "updated_at": d.get("updated_at"),
                        "region_name": d.get("data", {}).get("meta", {}).get("region_name"),
                        "hazard_type": d.get("data", {}).get("meta", {}).get("hazard_type"),
                        "start_year": d.get("data", {}).get("meta", {}).get("start_year"),
                        "end_year": d.get("data", {}).get("meta", {}).get("end_year"),
                        "headline": d.get("data", {}).get("summary", {}).get("headline"),
                    }
                    for d in all_docs
                ]
            return items

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            if self.backend_type == "mongodb" and self._mongo_db is not None:
                weather_count = self._mongo_db["weather_cache"].count_documents({})
                analysis_count = self._mongo_db["hazard_analyses"].count_documents({})
            else:
                assert self._tinydb is not None
                weather_count = len(self._tinydb.table("weather_cache"))
                analysis_count = len(self._tinydb.table("hazard_analyses"))

            return {
                "nosql_engine": self.backend_type,
                "storage_path": str(DEFAULT_TINYDB_PATH) if self.backend_type == "tinydb" else "MongoDB Cluster",
                "collections": {
                    "weather_cache_documents": weather_count,
                    "hazard_analyses_documents": analysis_count,
                },
            }


db = NoSQLDatabase()

