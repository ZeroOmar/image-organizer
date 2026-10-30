import type { EnrichedEntry, Selection, Step } from '@io/shared';
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { useConfig } from '../../api/hooks';
import { ActionDialog } from '../../components/ActionDialog';

interface Point {
  lat: number;
  lon: number;
}

function ClickToPlace({ onPick }: { onPick: (p: Point) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

function FlyTo({ point }: { point: Point | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lon], Math.max(map.getZoom(), 13));
  }, [point, map]);
  return null;
}

/** Map picker + search + manual entry + copy from another file. */
export function GpsDialog({
  selection,
  focused,
  entries,
  onClose,
}: {
  selection: Selection;
  focused: EnrichedEntry | null;
  entries: EnrichedEntry[];
  onClose: () => void;
}) {
  const config = useConfig().data;
  // A file that already has GPS starts on its position; otherwise we ask the browser where we are.
  const start = focused?.meta.gps ?? null;
  // Map view only (no marker): somewhere sensible while the location is being looked up.
  const fallbackCenter = entries.find((e) => e.meta.gps)?.meta.gps ?? { lat: 30.0444, lon: 31.2357 };
  const [point, setPoint] = useState<Point | null>(start ? { lat: start.lat, lon: start.lon } : null);
  const [fly, setFly] = useState<Point | null>(null);
  const [lat, setLat] = useState(start ? String(start.lat) : '');
  const [lon, setLon] = useState(start ? String(start.lon) : '');
  const [alt, setAlt] = useState(start?.alt != null ? String(start.alt) : '');
  const [clear, setClear] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const place = (p: Point, flyTo = false) => {
    setPoint(p);
    setLat(p.lat.toFixed(6));
    setLon(p.lon.toFixed(6));
    if (flyTo) setFly(p);
  };

  /** Browser geolocation needs a secure context (HTTPS, or localhost during local runs). */
  const locate = () => {
    if (!window.isSecureContext || !navigator.geolocation) {
      setGeoMsg('Current location needs HTTPS (or localhost).');
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        place({ lat: pos.coords.latitude, lon: pos.coords.longitude }, true);
        setAlt(pos.coords.altitude != null ? pos.coords.altitude.toFixed(1) : '');
        setGeoMsg(`Current location (±${Math.round(pos.coords.accuracy)} m)`);
      },
      (err) => {
        setLocating(false);
        setGeoMsg(err.code === err.PERMISSION_DENIED ? 'Location permission denied — pick a point on the map.' : 'Could not get the current location.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  useEffect(() => {
    if (!start) locate();
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async () => {
    if (!config || !q.trim()) return;
    setSearchErr(null);
    try {
      const res = await fetch(`${config.nominatimUrl.replace(/\/$/, '')}/search?format=json&limit=8&q=${encodeURIComponent(q)}`, {
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      setResults(await res.json());
    } catch {
      setSearchErr('Search failed (is the browser online?)');
    }
  };

  const withGps = entries.filter((e) => e.meta.gps);

  const { steps, invalid } = useMemo((): { steps: Step[] | null; invalid: string | null } => {
    if (clear) return { steps: [{ type: 'clearGps' }], invalid: null };
    const la = Number(lat);
    const lo = Number(lon);
    if (lat === '' || lon === '' || !Number.isFinite(la) || !Number.isFinite(lo)) return { steps: null, invalid: 'Pick a point or enter coordinates' };
    if (Math.abs(la) > 90 || Math.abs(lo) > 180) return { steps: null, invalid: 'Coordinates out of range' };
    const a = alt.trim() === '' ? null : Number(alt);
    if (a !== null && !Number.isFinite(a)) return { steps: null, invalid: 'Altitude must be a number' };
    return { steps: [{ type: 'setGps', lat: la, lon: lo, alt: a }], invalid: null };
  }, [clear, lat, lon, alt]);

  if (!config) return null;
  return (
    <ActionDialog title="GPS position" eyebrow="Batch action" selection={selection} steps={steps} invalid={invalid} onClose={onClose} wide>
      <div className="row">
        <input
          className="input grow"
          placeholder="Search a place…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          disabled={clear}
        />
        <button className="btn" onClick={search} disabled={clear || !q.trim()}>
          Search
        </button>
        <button className="btn" onClick={locate} disabled={clear || locating}>
          {locating ? 'Locating…' : 'Use my location'}
        </button>
      </div>
      {searchErr && <div className="error-text caption">{searchErr}</div>}
      {(locating || geoMsg) && <div className="caption muted">{locating ? 'Getting your current location…' : geoMsg}</div>}
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r) => (
            <button
              key={`${r.lat},${r.lon}`}
              onClick={() => {
                place({ lat: Number(r.lat), lon: Number(r.lon) }, true);
                setResults([]);
              }}
            >
              {r.display_name}
            </button>
          ))}
        </div>
      )}
      <div className="map" style={{ opacity: clear ? 0.4 : 1, pointerEvents: clear ? 'none' : undefined }}>
        <MapContainer
          center={point ? [point.lat, point.lon] : [fallbackCenter.lat, fallbackCenter.lon]}
          zoom={point ? 13 : 6}
          style={{ height: '100%' }}
        >
          {/* OSM blocks tile requests without a Referer; pin the policy so a proxy's `Referrer-Policy: no-referrer` can't strip it. */}
          <TileLayer url={config.mapTileUrl} attribution={config.mapAttribution} referrerPolicy="strict-origin-when-cross-origin" />
          <ClickToPlace onPick={(p) => place(p)} />
          <FlyTo point={fly} />
          {withGps.map((e) => (
            <CircleMarker key={e.rel} center={[e.meta.gps!.lat, e.meta.gps!.lon]} radius={4} pathOptions={{ color: '#b2b6bd', weight: 1, fillOpacity: 0.6 }} />
          ))}
          {point && <CircleMarker center={[point.lat, point.lon]} radius={9} pathOptions={{ color: '#00ca8e', weight: 3, fillOpacity: 0.35 }} />}
        </MapContainer>
      </div>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field grow">
          <label>Latitude</label>
          <input
            className="input mono"
            value={lat}
            disabled={clear}
            onChange={(e) => {
              setLat(e.target.value);
              const v = Number(e.target.value);
              if (Number.isFinite(v) && lon) setPoint({ lat: v, lon: Number(lon) });
            }}
          />
        </div>
        <div className="field grow">
          <label>Longitude</label>
          <input
            className="input mono"
            value={lon}
            disabled={clear}
            onChange={(e) => {
              setLon(e.target.value);
              const v = Number(e.target.value);
              if (Number.isFinite(v) && lat) setPoint({ lat: Number(lat), lon: v });
            }}
          />
        </div>
        <div className="field" style={{ width: 120 }}>
          <label>Altitude (m)</label>
          <input className="input mono" value={alt} disabled={clear} onChange={(e) => setAlt(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="row">
        <div className="field grow">
          <label>Copy from file</label>
          <select
            className="input"
            value=""
            disabled={clear || !withGps.length}
            onChange={(e) => {
              const src = withGps.find((x) => x.rel === e.target.value);
              if (src?.meta.gps) {
                place(src.meta.gps, true);
                setAlt(src.meta.gps.alt != null ? String(src.meta.gps.alt) : '');
              }
            }}
          >
            <option value="">{withGps.length ? 'Choose a file with GPS in this folder…' : 'No files with GPS in this folder'}</option>
            {withGps.map((e) => (
              <option key={e.rel} value={e.rel}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <label className="check" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
          Remove GPS instead
        </label>
      </div>
    </ActionDialog>
  );
}
