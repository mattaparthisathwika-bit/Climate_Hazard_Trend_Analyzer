const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export async function fetchPresetRegions() {
  const res = await fetch(`${API_BASE}/api/regions/presets`)
  if (!res.ok) throw new Error('Failed to load preset regions')
  return res.json()
}

export async function geocodeSearch(query) {
  const res = await fetch(`${API_BASE}/api/regions/geocode?q=${encodeURIComponent(query)}`)
  if (!res.ok) throw new Error('Geocoding search failed')
  return res.json()
}

export async function runClimateAnalysis(payload) {
  const res = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.detail || 'Climate hazard analysis failed')
  }
  return data
}

export async function fetchRecentAnalyses() {
  const res = await fetch(`${API_BASE}/api/analyses/recent`)
  if (!res.ok) throw new Error('Failed to load recent analyses')
  return res.json()
}

export async function downloadAnalysisCsv(payload) {
  const res = await fetch(`${API_BASE}/api/export/csv`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to export CSV')
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const match = disposition.match(/filename="(.+)"/)
  const filename = match ? match[1] : `climate_hazard_report_${Date.now()}.csv`

  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.URL.revokeObjectURL(url)
}

