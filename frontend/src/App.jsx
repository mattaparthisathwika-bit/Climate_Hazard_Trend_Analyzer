import React, { useState, useEffect, useCallback } from 'react'
import {
  Flame,
  CloudRain,
  SunDim,
  MapPin,
  Search,
  Calendar,
  Sliders,
  Download,
  FileText,
  Database,
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  Activity,
  RefreshCw,
  CheckCircle2,
  Compass,
  Info,
  X,
} from 'lucide-react'
import RegionMapSelector from './components/RegionMapSelector'
import TrendCharts from './components/TrendCharts'
import {
  fetchPresetRegions,
  geocodeSearch,
  runClimateAnalysis,
  downloadAnalysisCsv,
} from './api'
import { generateClimatePdfReport } from './utils/exportPdf'

const HAZARD_OPTIONS = [
  {
    id: 'heatwave',
    label: 'Heatwave',
    badge: 'Default',
    icon: Flame,
    activeClass: 'border-amber-500 bg-amber-500/15 text-amber-300',
    desc: '3+ consecutive days with daily Tmax above the regional 95th percentile',
  },
  {
    id: 'heavy_rainfall',
    label: 'Heavy Rainfall',
    badge: 'WMO R95p',
    icon: CloudRain,
    activeClass: 'border-sky-500 bg-sky-500/15 text-sky-300',
    desc: 'Extreme wet-day precipitation exceeding the 95th percentile threshold',
  },
  {
    id: 'drought',
    label: 'Drought / Dry Spell',
    badge: 'WMO CDD',
    icon: SunDim,
    activeClass: 'border-orange-500 bg-orange-500/15 text-orange-300',
    desc: 'Prolonged dry spells of 14+ consecutive days with precipitation < 1 mm',
  },
]

const QUICK_RANGES = [
  { label: '1990–2020 (Case Study)', start: 1990, end: 2020 },
  { label: '1990–2024 (35 Yrs)', start: 1990, end: 2024 },
  { label: '1980–2024 (45 Yrs)', start: 1980, end: 2024 },
  { label: '2000–2024 (Recent)', start: 2000, end: 2024 },
]

const DEMO_SCENARIOS = [
  {
    id: 'delhi-heatwave',
    label: 'Delhi Heatwaves',
    tag: 'Case Study Default',
    icon: '🇮🇳',
    regionMode: 'city',
    regionName: 'New Delhi, India',
    latitude: 28.6139,
    longitude: 77.209,
    hazardType: 'heatwave',
    startYear: 1990,
    endYear: 2020,
    percentile: 95.0,
    minDays: 3,
  },
  {
    id: 'madrid-heatwave',
    label: 'Madrid Heatwaves',
    tag: '+41.4% Escalation',
    icon: '🇪🇸',
    regionMode: 'city',
    regionName: 'Madrid, Spain',
    latitude: 40.4168,
    longitude: -3.7038,
    hazardType: 'heatwave',
    startYear: 1990,
    endYear: 2020,
    percentile: 95.0,
    minDays: 3,
  },
  {
    id: 'mumbai-monsoon',
    label: 'Mumbai Monsoons',
    tag: 'Extreme Rain (R95p)',
    icon: '🌧️',
    regionMode: 'city',
    regionName: 'Mumbai, India',
    latitude: 19.076,
    longitude: 72.8777,
    hazardType: 'heavy_rainfall',
    startYear: 1990,
    endYear: 2024,
    percentile: 95.0,
    minDays: 1,
  },
  {
    id: 'rajasthan-drought',
    label: 'Rajasthan Drought',
    tag: 'WMO CDD 14+ Days',
    icon: '🏜️',
    regionMode: 'state',
    regionName: 'Rajasthan (State), India',
    latitude: 26.9124,
    longitude: 73.847,
    bbox: { min_lat: 24.5, max_lat: 29.5, min_lon: 70.5, max_lon: 76.5 },
    hazardType: 'drought',
    startYear: 1990,
    endYear: 2024,
    percentile: 90.0,
    minDays: 14,
  },
  {
    id: 'phoenix-heat',
    label: 'Phoenix Extreme Heat',
    tag: 'Desert Mega-Streaks',
    icon: '🌵',
    regionMode: 'city',
    regionName: 'Phoenix, Arizona, USA',
    latitude: 33.4484,
    longitude: -112.074,
    hazardType: 'heatwave',
    startYear: 1990,
    endYear: 2024,
    percentile: 95.0,
    minDays: 3,
  },
]

export default function App() {
  // Region & Query State
  const [presets, setPresets] = useState([])
  const [regionMode, setRegionMode] = useState('city') // 'city' | 'state' | 'bbox' | 'point'
  const [regionName, setRegionName] = useState('New Delhi, India')
  const [latitude, setLatitude] = useState(28.6139)
  const [longitude, setLongitude] = useState(77.209)
  const [bbox, setBbox] = useState({
    min_lat: 25.0,
    max_lat: 28.8,
    min_lon: 77.0,
    max_lon: 84.0,
  })

  // Hazard & Time Range State (Heatwave selected by default, 1990–2020 default)
  const [hazardType, setHazardType] = useState('heatwave')
  const [startYear, setStartYear] = useState(1990)
  const [endYear, setEndYear] = useState(2020)
  const [percentile, setPercentile] = useState(95.0)
  const [minConsecutiveDays, setMinConsecutiveDays] = useState(3)
  const [unit, setUnit] = useState('celsius')
  const [useDynamicCalendar, setUseDynamicCalendar] = useState(false)

  // Live Geocoding Search State
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)

  // Analysis Output State
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [severityFilter, setSeverityFilter] = useState('All')
  const [exportingCsv, setExportingCsv] = useState(false)
  const [showMethodologyModal, setShowMethodologyModal] = useState(false)
  const [activeViewTab, setActiveViewTab] = useState('all') // 'all' | 'trends' | 'duration' | 'decadal' | 'table'

  // Load presets on mount
  useEffect(() => {
    fetchPresetRegions()
      .then((data) => {
        if (data?.presets) setPresets(data.presets)
      })
      .catch((err) => console.warn('Preset load warning:', err))
  }, [])

  const buildPayload = useCallback(
    (forceRefresh = false) => ({
      region_mode: regionMode,
      region_name: regionName,
      latitude: regionMode === 'bbox' ? null : Number(latitude),
      longitude: regionMode === 'bbox' ? null : Number(longitude),
      bbox: regionMode === 'bbox' ? bbox : null,
      hazard_type: hazardType,
      start_year: Number(startYear),
      end_year: Number(endYear),
      percentile_threshold: Number(percentile),
      min_consecutive_days: Number(minConsecutiveDays),
      unit,
      use_dynamic_calendar_percentile: useDynamicCalendar,
      force_refresh: forceRefresh,
    }),
    [
      regionMode,
      regionName,
      latitude,
      longitude,
      bbox,
      hazardType,
      startYear,
      endYear,
      percentile,
      minConsecutiveDays,
      unit,
      useDynamicCalendar,
    ]
  )

  const executeAnalysis = useCallback(
    async (customPayload = null) => {
      setLoading(true)
      setError(null)
      try {
        const payload = customPayload || buildPayload(false)
        const res = await runClimateAnalysis(payload)
        setAnalysis(res)
      } catch (err) {
        setError(err.message || 'Failed to analyze climate hazard trends')
      } finally {
        setLoading(false)
      }
    },
    [buildPayload]
  )

  // Run initial default analysis (New Delhi Heatwave 1990-2020) on mount
  useEffect(() => {
    executeAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle preset selection
  const handleSelectPreset = (preset) => {
    setRegionName(preset.name)
    if (preset.category === 'bbox' && preset.bbox) {
      setRegionMode('bbox')
      setBbox(preset.bbox)
      setLatitude(preset.latitude)
      setLongitude(preset.longitude)
    } else if (preset.category === 'state' && preset.bbox) {
      setRegionMode('state')
      setLatitude(preset.latitude)
      setLongitude(preset.longitude)
      setBbox(preset.bbox)
    } else {
      setRegionMode('city')
      setLatitude(preset.latitude)
      setLongitude(preset.longitude)
    }
  }

  // Handle geocoding search
  const handleSearchSubmit = async (e) => {
    e.preventDefault()
    if (!searchQuery || searchQuery.trim().length < 2) return
    setIsSearching(true)
    try {
      const res = await geocodeSearch(searchQuery.trim())
      setSearchResults(res.results || [])
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handlePickSearchResult = (item) => {
    setRegionName(item.name)
    setLatitude(item.latitude)
    setLongitude(item.longitude)
    if (item.bbox) {
      setBbox(item.bbox)
      setRegionMode(item.category === 'bbox' ? 'bbox' : 'city')
    } else {
      setRegionMode('city')
    }
    setSearchResults([])
    setSearchQuery('')
  }

  // Handle interactive map point click
  const handleMapPointClick = (lat, lon) => {
    setRegionMode('point')
    setLatitude(lat)
    setLongitude(lon)
    setRegionName(`Custom Pin (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`)
  }

  // Handle hazard switch with sensible default streak duration
  const handleHazardChange = (newHazard) => {
    setHazardType(newHazard)
    if (newHazard === 'heatwave') {
      setMinConsecutiveDays(3)
      setPercentile(95.0)
    } else if (newHazard === 'heavy_rainfall') {
      setMinConsecutiveDays(1)
      setPercentile(95.0)
    } else if (newHazard === 'drought') {
      setMinConsecutiveDays(14)
      setPercentile(90.0)
    }
  }

  const handleExportCsv = async () => {
    setExportingCsv(true)
    try {
      await downloadAnalysisCsv(buildPayload(false))
    } catch (err) {
      setError(err.message)
    } finally {
      setExportingCsv(false)
    }
  }

  const handleLaunchScenario = (sc) => {
    setRegionMode(sc.regionMode)
    setRegionName(sc.regionName)
    setLatitude(sc.latitude)
    setLongitude(sc.longitude)
    if (sc.bbox) setBbox(sc.bbox)
    setHazardType(sc.hazardType)
    setStartYear(sc.startYear)
    setEndYear(sc.endYear)
    setPercentile(sc.percentile)
    setMinConsecutiveDays(sc.minDays)

    const payload = {
      region_mode: sc.regionMode,
      region_name: sc.regionName,
      latitude: sc.regionMode === 'bbox' ? null : Number(sc.latitude),
      longitude: sc.regionMode === 'bbox' ? null : Number(sc.longitude),
      bbox: sc.bbox || null,
      hazard_type: sc.hazardType,
      start_year: sc.startYear,
      end_year: sc.endYear,
      percentile_threshold: sc.percentile,
      min_consecutive_days: sc.minDays,
      unit,
      use_dynamic_calendar_percentile: false,
      force_refresh: false,
    }
    executeAnalysis(payload)
  }

  const filteredEvents =
    analysis?.top_events?.filter((ev) =>
      severityFilter === 'All' ? true : ev.severity === severityFilter
    ) || []

  const yearOptions = Array.from({ length: 2025 - 1950 + 1 }, (_, i) => 1950 + i)

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-red-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Flame className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-white">
                  Climate Hazard Trend Analyzer
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  ERA5 Reanalysis + NoSQL
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Historical Extreme Weather Detection, Non-Parametric Mann-Kendall & OLS Trend Intelligence
              </p>
            </div>
          </div>

          {/* Export & Cache Status Actions */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowMethodologyModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-sky-400 border border-sky-500/30 transition"
            >
              <Info className="w-3.5 h-3.5" />
              Methodology Guide
            </button>

            {analysis?.meta && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                <Database className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-slate-400">NoSQL ({analysis.meta.nosql_engine}):</span>
                <span
                  className={`font-mono font-semibold ${
                    analysis.meta.analysis_cache_hit || analysis.meta.weather_cache_hit
                      ? 'text-emerald-400'
                      : 'text-amber-400'
                  }`}
                >
                  {analysis.meta.analysis_cache_hit
                    ? 'CACHE HIT'
                    : analysis.meta.weather_cache_hit
                    ? 'WEATHER HIT'
                    : 'INGESTED LIVE'}
                </span>
                <span className="text-slate-500 font-mono">
                  ({analysis.meta.execution_time_ms}ms)
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleExportCsv}
              disabled={!analysis || exportingCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              {exportingCsv ? 'Exporting...' : 'Export CSV'}
            </button>

            <button
              type="button"
              onClick={() => generateClimatePdfReport(analysis)}
              disabled={!analysis}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 transition shadow-sm disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" />
              Export PDF Report
            </button>
          </div>
        </div>

        {/* 1-Click Showcase Scenarios Bar */}
        <div className="border-t border-slate-800/60 bg-slate-950/70 py-2 px-4 sm:px-6">
          <div className="max-w-[1440px] mx-auto flex items-center gap-2 overflow-x-auto text-xs no-scrollbar">
            <span className="text-slate-400 font-semibold shrink-0 flex items-center gap-1">
              <Compass className="w-3.5 h-3.5 text-amber-400" />
              1-Click Demo Scenarios:
            </span>
            {DEMO_SCENARIOS.map((sc) => {
              const isActive = regionName === sc.regionName && hazardType === sc.hazardType
              return (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => handleLaunchScenario(sc)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition shrink-0 ${
                    isActive
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-slate-900 hover:bg-slate-850 text-slate-300 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span>{sc.icon}</span>
                  <span>{sc.label}</span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full ${isActive ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                    {sc.tag}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </header>

      {/* Main Content Grid */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Control Column (4 cols on desktop) */}
        <aside className="lg:col-span-4 space-y-5">
          {/* Step 1: Region Selection Card */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                  1. Geographic Region
                </h2>
              </div>
              <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                {regionMode.toUpperCase()}
              </span>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              {[
                { id: 'city', label: 'City / State' },
                { id: 'bbox', label: 'Lat-Lon Box' },
                { id: 'point', label: 'Coordinates' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRegionMode(tab.id)}
                  className={`py-1.5 px-2 rounded-md font-medium transition ${
                    (regionMode === tab.id || (tab.id === 'city' && regionMode === 'state'))
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Curated Preset Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Quick Select City, State, or Regional Box
              </label>
              <select
                value={presets.find((p) => p.name === regionName)?.id || ''}
                onChange={(e) => {
                  const found = presets.find((p) => p.id === e.target.value)
                  if (found) handleSelectPreset(found)
                }}
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
              >
                <option value="" disabled>
                  -- Choose a Preset Region --
                </option>
                <optgroup label="Cities (Global & India)">
                  {presets
                    .filter((p) => p.category === 'city')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.climate_zone}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="States / Provinces">
                  {presets
                    .filter((p) => p.category === 'state')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Custom Lat-Lon Bounding Boxes">
                  {presets
                    .filter((p) => p.category === 'bbox')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            {/* Live Global Geocoding Search */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Search Any City or State Worldwide
              </label>
              <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="e.g. Ahmedabad, Texas, Paris, Cairo..."
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSearching}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 transition"
                >
                  {isSearching ? '...' : 'Find'}
                </button>
              </form>

              {searchResults.length > 0 && (
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 divide-y divide-slate-800/80">
                  {searchResults.map((item, i) => (
                    <button
                      key={`${item.name}-${i}`}
                      type="button"
                      onClick={() => handlePickSearchResult(item)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-slate-800/80 flex items-center justify-between gap-2 transition"
                    >
                      <span className="font-medium text-slate-200 truncate">{item.name}</span>
                      <span className="font-mono text-[10px] text-amber-400 shrink-0">
                        {item.latitude.toFixed(2)}°, {item.longitude.toFixed(2)}°
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Custom Lat-Lon Bounding Box Editor */}
            {regionMode === 'bbox' ? (
              <div className="p-3 rounded-lg bg-slate-950/90 border border-amber-500/30 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" />
                    Custom Lat-Lon Bounding Box
                  </span>
                  <span className="text-[10px] text-slate-400">Max span 25° × 25°</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-slate-400 block">Min Latitude (South)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bbox.min_lat}
                      onChange={(e) => setBbox({ ...bbox, min_lat: parseFloat(e.target.value) || 0 })}
                      className="w-full mt-0.5 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block">Max Latitude (North)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bbox.max_lat}
                      onChange={(e) => setBbox({ ...bbox, max_lat: parseFloat(e.target.value) || 0 })}
                      className="w-full mt-0.5 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block">Min Longitude (West)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bbox.min_lon}
                      onChange={(e) => setBbox({ ...bbox, min_lon: parseFloat(e.target.value) || 0 })}
                      className="w-full mt-0.5 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block">Max Longitude (East)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bbox.max_lon}
                      onChange={(e) => setBbox({ ...bbox, max_lon: parseFloat(e.target.value) || 0 })}
                      className="w-full mt-0.5 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-white"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <label className="text-[11px] text-slate-400 block">Latitude (°N)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={latitude}
                    onChange={(e) => {
                      setLatitude(parseFloat(e.target.value) || 0)
                      setRegionMode('point')
                    }}
                    className="w-full mt-0.5 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block">Longitude (°E)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={longitude}
                    onChange={(e) => {
                      setLongitude(parseFloat(e.target.value) || 0)
                      setRegionMode('point')
                    }}
                    className="w-full mt-0.5 rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 font-mono text-xs text-slate-100"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Step 2: Climate Hazard Selector (Heatwave Default) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg space-y-3">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                2. Climate Hazard Type
              </h2>
            </div>

            <div className="space-y-2">
              {HAZARD_OPTIONS.map((opt) => {
                const Icon = opt.icon
                const isSelected = hazardType === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleHazardChange(opt.id)}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-start gap-3 ${
                      isSelected
                        ? opt.activeClass
                        : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <Icon className="w-5 h-5 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-xs">{opt.label}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900/80 border border-slate-700/80">
                          {opt.badge}
                        </span>
                      </div>
                      <p className="text-[11px] opacity-80 mt-0.5 leading-snug">{opt.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 3: Time Range & Threshold Parameters */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg space-y-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                3. Time Range & Domain Rules
              </h2>
            </div>

            {/* Quick Time Range Presets */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_RANGES.map((qr) => {
                const active = startYear === qr.start && endYear === qr.end
                return (
                  <button
                    key={qr.label}
                    type="button"
                    onClick={() => {
                      setStartYear(qr.start)
                      setEndYear(qr.end)
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition ${
                      active
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {qr.label}
                  </button>
                )
              })}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Start Year</label>
                <select
                  value={startYear}
                  onChange={(e) => setStartYear(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs font-mono text-white"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">End Year</label>
                <select
                  value={endYear}
                  onChange={(e) => setEndYear(Number(e.target.value))}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-xs font-mono text-white"
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Domain Threshold Controls */}
            <div className="pt-2 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  Percentile Threshold
                </span>
                <span className="font-mono font-bold text-amber-400">{percentile}th pct</span>
              </div>
              <input
                type="range"
                min="80"
                max="99"
                step="1"
                value={percentile}
                onChange={(e) => setPercentile(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Min Consecutive Streak Days</span>
                <span className="font-mono font-bold text-amber-400">{minConsecutiveDays}+ days</span>
              </div>
              <input
                type="range"
                min="1"
                max="21"
                step="1"
                value={minConsecutiveDays}
                onChange={(e) => setMinConsecutiveDays(Number(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-slate-400">Temperature Unit</span>
                <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setUnit('celsius')}
                    className={`px-2.5 py-1 rounded-md font-mono ${
                      unit === 'celsius' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
                    }`}
                  >
                    °C
                  </button>
                  <button
                    type="button"
                    onClick={() => setUnit('fahrenheit')}
                    className={`px-2.5 py-1 rounded-md font-mono ${
                      unit === 'fahrenheit' ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-400'
                    }`}
                  >
                    °F
                  </button>
                </div>
              </div>

              {hazardType === 'heatwave' && (
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={useDynamicCalendar}
                    onChange={(e) => setUseDynamicCalendar(e.target.checked)}
                    className="rounded accent-amber-500"
                  />
                  <span>Use 15-day rolling calendar percentile (WMO CTX90pct)</span>
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={() => executeAnalysis()}
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Ingesting & Analyzing Climate Series...' : 'Analyze Climate Hazard Trends'}
            </button>
          </div>
        </aside>

        {/* Right Visualization & Insights Column (8 cols on desktop) */}
        <section className="lg:col-span-8 space-y-6">
          {error && (
            <div className="rounded-xl border border-red-500/50 bg-red-950/40 p-4 flex items-start gap-3 text-red-200">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-bold text-sm text-red-300">Analysis Validation / API Error</div>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Interactive Leaflet GIS Map */}
          <RegionMapSelector
            regionMode={regionMode}
            regionName={regionName}
            latitude={latitude}
            longitude={longitude}
            bbox={regionMode === 'bbox' || regionMode === 'state' ? bbox : null}
            sampledCoords={analysis?.meta?.sampled_coordinates || []}
            onSelectPoint={handleMapPointClick}
          />

          {loading && (
            <div className="rounded-xl border border-amber-500/40 bg-slate-900/90 p-5 shadow-xl space-y-3 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                  <span className="text-sm font-bold text-white">
                    Ingesting & Analyzing {regionName} ({startYear}–{endYear})...
                  </span>
                </div>
                <span className="text-xs font-mono text-amber-400">ERA5 Reanalysis</span>
              </div>
              <p className="text-xs text-slate-400">
                Querying multi-decade daily observations, cleaning sensor gaps & outliers, detecting {hazardType} streaks, and running Mann-Kendall & OLS statistical regressions.
              </p>
              <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div className="bg-gradient-to-r from-amber-500 to-orange-500 h-1.5 rounded-full w-2/3 animate-[pulse_1s_ease-in-out_infinite]" />
              </div>
            </div>
          )}

          {/* Summary Insight Hero Banner */}
          {analysis && (
            <>
              <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 via-slate-900 to-slate-900 p-5 shadow-xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-400">
                    <TrendingUp className="w-4 h-4" />
                    Primary Climate Hazard Insight ({analysis.meta.start_year}–{analysis.meta.end_year})
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    Rule Threshold: {analysis.threshold_info.primary_threshold_value}
                    {analysis.meta.hazard_type === 'heavy_rainfall' || analysis.meta.hazard_type === 'drought'
                      ? ' mm'
                      : analysis.meta.temperature_unit_symbol}{' '}
                    ({analysis.threshold_info.percentile}th pct, {analysis.threshold_info.min_consecutive_days}+ days)
                  </span>
                </div>

                <h2 className="text-xl sm:text-2xl font-extrabold text-white leading-snug">
                  “{analysis.summary.headline}”
                </h2>

                <p className="text-xs text-slate-300 leading-relaxed">
                  <strong>Detection Logic:</strong> {analysis.threshold_info.rule_description}
                </p>

                {/* 4 KPI Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-400">Early vs Recent Frequency</div>
                    <div className="text-lg font-extrabold font-mono text-amber-400 mt-0.5">
                      {analysis.summary.early_period.avg_events_per_year} →{' '}
                      {analysis.summary.recent_period.avg_events_per_year}
                      <span className="text-xs font-normal text-slate-400"> /yr</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {analysis.summary.early_period.label} vs {analysis.summary.recent_period.label}
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-400">Mann-Kendall Trend Test</div>
                    <div className="text-lg font-extrabold font-mono text-sky-400 mt-0.5">
                      Z = {analysis.trends.frequency.mann_kendall.z_score >= 0 ? '+' : ''}
                      {analysis.trends.frequency.mann_kendall.z_score}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                      p = {analysis.trends.frequency.mann_kendall.p_value} (
                      {analysis.trends.frequency.mann_kendall.significant_at_95 ? 'Sig. p<0.05' : 'Non-sig.'})
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-400">OLS Regression Rate</div>
                    <div className="text-lg font-extrabold font-mono text-emerald-400 mt-0.5">
                      {analysis.trends.frequency.ols.slope_per_decade >= 0 ? '+' : ''}
                      {analysis.trends.frequency.ols.slope_per_decade}
                      <span className="text-xs font-normal text-slate-400"> ev/dec</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      Days Slope: {analysis.trends.total_hazard_days.ols.slope_per_decade >= 0 ? '+' : ''}
                      {analysis.trends.total_hazard_days.ols.slope_per_decade} d/dec
                    </div>
                  </div>

                  <div className="rounded-lg bg-slate-950/80 border border-slate-800 p-3">
                    <div className="text-[11px] text-slate-400">Peak Record Year</div>
                    <div className="text-lg font-extrabold font-mono text-rose-400 mt-0.5">
                      {analysis.summary.peak_year.year}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {analysis.summary.peak_year.total_hazard_days} days ({analysis.summary.peak_year.event_count}{' '}
                      events)
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive View Navigation Tabs */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs overflow-x-auto">
                {[
                  { id: 'all', label: '📊 All Views' },
                  { id: 'charts', label: '📈 Time-Series Trends' },
                  { id: 'diagnostics', label: '🛡️ Data Quality & Findings' },
                  { id: 'table', label: '📋 Extreme Events Catalog' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveViewTab(tab.id)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition shrink-0 ${
                      activeViewTab === tab.id
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Interactive Chart.js Time-Series Plots */}
              {(activeViewTab === 'all' || activeViewTab === 'charts') && (
                <TrendCharts analysis={analysis} />
              )}

              {/* Analytical Findings & Critical Thinking / Data Hygiene Grid */}
              {/* Analytical Findings & Critical Thinking / Data Hygiene Grid */}
              {(activeViewTab === 'all' || activeViewTab === 'diagnostics') && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Key Analytical Findings */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg space-y-3">
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        Diagnostic Breakdown & Statistical Evidence
                      </h3>
                    </div>
                    <div className="space-y-3">
                      {analysis.summary.key_findings.map((f, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-slate-950/70 border border-slate-800/90 space-y-1"
                        >
                          <div className="text-xs font-bold text-amber-300">{f.title}</div>
                          <p className="text-xs text-slate-300 leading-relaxed">{f.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Critical Thinking Caveats & Data Hygiene Report */}
                  <div className="space-y-6">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg space-y-3">
                      <div className="flex items-center gap-2">
                        <Info className="w-4 h-4 text-sky-400" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                          Critical Thinking & Methodological Honesty
                        </h3>
                      </div>
                      <ul className="space-y-2 text-xs text-slate-300">
                        {analysis.summary.critical_thinking_caveats.map((c, idx) => (
                          <li
                            key={idx}
                            className="p-2.5 rounded-lg bg-sky-950/25 border border-sky-500/20 leading-relaxed"
                          >
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                            Data Handling & Quality Pipeline
                          </h3>
                        </div>
                        <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                          {analysis.data_quality.usable_completeness_pct}% Complete
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 text-xs">
                        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Daily Observations</span>
                          <span className="font-mono font-bold text-slate-100">
                            {analysis.data_quality.total_days_in_span.toLocaleString()} days
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Short Gaps Interpolated</span>
                          <span className="font-mono font-bold text-slate-100">
                            {analysis.data_quality.interpolated_short_gap_days} days
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Spikes / Outliers Cleaned</span>
                          <span className="font-mono font-bold text-slate-100">
                            {analysis.data_quality.outliers_and_spikes_cleaned} records
                          </span>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                          <span className="text-slate-400 block text-[11px]">Spatial Grid Nodes</span>
                          <span className="font-mono font-bold text-slate-100">
                            {analysis.meta.sampled_coordinates?.length || 1} point(s)
                          </span>
                        </div>
                      </div>

                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        {analysis.data_quality.cleaning_methodology}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Top Detected Historical Hazard Events Table */}
              {(activeViewTab === 'all' || activeViewTab === 'table') && (
                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Detected Extreme Hazard Events Catalog ({analysis.total_events_detected} Total Events)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Showing top historical streaks ranked by duration and cumulative threshold excess
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 text-xs self-start">
                      {['All', 'Extreme', 'Severe', 'Moderate'].map((sev) => (
                        <button
                          key={sev}
                          type="button"
                          onClick={() => setSeverityFilter(sev)}
                          className={`px-2.5 py-1 rounded-md font-medium transition ${
                            severityFilter === sev
                              ? 'bg-amber-500 text-slate-950 font-bold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {sev}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 uppercase text-[11px]">
                          <th className="py-2.5 px-3">Start Date</th>
                          <th className="py-2.5 px-3">End Date</th>
                          <th className="py-2.5 px-3">Duration</th>
                          <th className="py-2.5 px-3">Peak Value</th>
                          <th className="py-2.5 px-3">Threshold</th>
                          <th className="py-2.5 px-3">Cumulative Excess</th>
                          <th className="py-2.5 px-3">Severity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {filteredEvents.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="py-6 text-center text-slate-500 font-sans">
                              No events matching filter '{severityFilter}' in this time range.
                            </td>
                          </tr>
                        ) : (
                          filteredEvents.map((ev) => (
                            <tr key={ev.event_id} className="hover:bg-slate-800/40 transition">
                              <td className="py-2.5 px-3 text-slate-200">{ev.start_date}</td>
                              <td className="py-2.5 px-3 text-slate-200">{ev.end_date}</td>
                              <td className="py-2.5 px-3 font-bold text-amber-400">
                                {ev.duration_days} days
                              </td>
                              <td className="py-2.5 px-3 text-slate-100">{ev.peak_value}</td>
                              <td className="py-2.5 px-3 text-slate-400">{ev.threshold_ref}</td>
                              <td className="py-2.5 px-3 text-sky-300">+{ev.cumulative_excess}</td>
                              <td className="py-2.5 px-3 font-sans">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    ev.severity === 'Extreme'
                                      ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                      : ev.severity === 'Severe'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  }`}
                                >
                                  {ev.severity}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Methodology Guide Modal */}
      {showMethodologyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Info className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">Climatological Methodology & Statistical Guide</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMethodologyModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-bold text-amber-400 text-xs">1. Percentile-Based Hazard Detection (WMO Standards)</div>
                <p>
                  A fixed temperature (e.g. 35°C) cannot define heatwaves globally because adaptation varies between Delhi, Madrid, and London. We anchor the 95th percentile to an early baseline (e.g. 1990–2004) so recent global warming doesn't artificially raise the bar and hide the true frequency trend.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-bold text-sky-400 text-xs">2. Non-Parametric Mann-Kendall Test & Sen's Slope</div>
                <p>
                  Extreme hazard event counts are discrete and often skewed by strong multi-year oscillations like El Niño. The <strong>Mann-Kendall test</strong> evaluates monotonic trends rank-wise without assuming Gaussian distribution, and <strong>Sen's slope</strong> computes the median slope resistant to single-year extremes.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-bold text-emerald-400 text-xs">3. Data Hygiene: 15-Day Rolling MAD & Linear Interpolation</div>
                <p>
                  Real weather series contain sensor spikes and dropouts. We apply continuous daily calendar re-indexing and 15-day rolling Median Absolute Deviation (MAD) spike screening. Gaps &le; 3 days are linearly interpolated; longer gaps are preserved to never fabricate synthetic streaks.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                <div className="font-bold text-purple-400 text-xs">4. ECMWF ERA5 Reanalysis</div>
                <p>
                  Data is fetched from ECMWF ERA5/ERA5-Land via Open-Meteo. Spanning 1940 to present at ~9–25 km resolution, it represents the gold standard benchmark used by the IPCC and global climate research institutions.
                </p>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowMethodologyModal(false)}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
              >
                Close Guide
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 px-6 text-center text-xs text-slate-500">
        Climate Hazard Trend Analyzer • Built with React 18, Chart.js, Leaflet GIS, FastAPI, SciPy & Dual-Mode NoSQL (TinyDB / MongoDB) • Historical Meteorology via Open-Meteo ERA5 Reanalysis
      </footer>
    </div>
  )
}

