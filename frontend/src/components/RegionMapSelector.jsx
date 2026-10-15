import React, { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Rectangle, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

// Fix default Leaflet marker icon paths in Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function MapUpdater({ center, bbox, regionMode }) {
  const map = useMap()
  useEffect(() => {
    if (regionMode === 'bbox' && bbox) {
      const bounds = [
        [bbox.min_lat, bbox.min_lon],
        [bbox.max_lat, bbox.max_lon],
      ]
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 })
    } else if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      map.flyTo(center, 6, { duration: 1.1 })
    }
  }, [map, center?.[0], center?.[1], regionMode, bbox?.min_lat, bbox?.max_lat, bbox?.min_lon, bbox?.max_lon])
  return null
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng
      onMapClick(Number(lat.toFixed(4)), Number(lng.toFixed(4)))
    },
  })
  return null
}

export default function RegionMapSelector({
  regionMode,
  regionName,
  latitude,
  longitude,
  bbox,
  sampledCoords = [],
  onSelectPoint,
}) {
  const centerLat =
    regionMode === 'bbox' && bbox
      ? (bbox.min_lat + bbox.max_lat) / 2
      : Number(latitude) || 28.6139
  const centerLon =
    regionMode === 'bbox' && bbox
      ? (bbox.min_lon + bbox.max_lon) / 2
      : Number(longitude) || 77.209

  const rectBounds =
    bbox && Number.isFinite(bbox.min_lat)
      ? [
          [bbox.min_lat, bbox.min_lon],
          [bbox.max_lat, bbox.max_lon],
        ]
      : null

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900/70 shadow-lg">
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/95 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-semibold text-slate-200">Interactive Spatial Selector (Leaflet GIS)</span>
          <span className="text-slate-400 hidden sm:inline">
            — Click anywhere on the map to pin a custom coordinate
          </span>
        </div>
        <div className="font-mono text-slate-300">
          {regionMode === 'bbox' && bbox
            ? `[${bbox.min_lat.toFixed(1)}°..${bbox.max_lat.toFixed(1)}°N, ${bbox.min_lon.toFixed(1)}°..${bbox.max_lon.toFixed(1)}°E]`
            : `${centerLat.toFixed(3)}°, ${centerLon.toFixed(3)}°`}
        </div>
      </div>

      <div className="h-[300px] w-full">
        <MapContainer
          center={[centerLat, centerLon]}
          zoom={5}
          scrollWheelZoom={true}
          className="h-full w-full z-0"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <MapUpdater center={[centerLat, centerLon]} bbox={bbox} regionMode={regionMode} />
          <MapClickHandler onMapClick={onSelectPoint} />

          {rectBounds && (
            <Rectangle
              bounds={rectBounds}
              pathOptions={{
                color: '#f59e0b',
                weight: 2,
                fillColor: '#f59e0b',
                fillOpacity: 0.18,
                dashArray: '6 4',
              }}
            />
          )}

          <Marker position={[centerLat, centerLon]}>
            <Popup>
              <div className="text-xs">
                <div className="font-bold text-amber-400 mb-0.5">{regionName}</div>
                <div className="font-mono text-slate-300">
                  Lat: {centerLat.toFixed(4)}°, Lon: {centerLon.toFixed(4)}°
                </div>
              </div>
            </Popup>
          </Marker>

          {sampledCoords.map((pt, idx) => (
            <CircleMarker
              key={`${pt.lat}-${pt.lon}-${idx}`}
              center={[pt.lat, pt.lon]}
              radius={5}
              pathOptions={{
                color: '#38bdf8',
                fillColor: '#0284c7',
                fillOpacity: 0.85,
                weight: 1.5,
              }}
            >
              <Popup>
                <div className="text-xs font-mono">
                  Reanalysis Grid Node #{idx + 1}: ({pt.lat.toFixed(3)}°, {pt.lon.toFixed(3)}°)
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

