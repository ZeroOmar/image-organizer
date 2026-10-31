import { gatherPoint, type EnrichedEntry, type FileRef } from '@io/shared';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import { runJobAndWait, useConfig } from '../api/hooks';
import { PlaceSearch } from '../components/PlaceSearch';
import type { WorkspaceApi } from '../organize/Workspace';
import { REL_MIME } from './FileList';

type Mode = 'select' | 'place' | 'circle';
type LatLon = { lat: number; lon: number };
interface Drawn {
  center: LatLon;
  radius: number;
}

/** Leaflet paints SVG, so read the colors from tokens.css instead of hard-coding them. */
function useTokens() {
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const t = (n: string) => css.getPropertyValue(n).trim();
    return { accent: t('--accent'), ink: t('--ink'), warning: t('--warning'), canvas: t('--canvas') };
  }, []);
}

const pinIcon = L.divIcon({ className: 'gps-pin', iconSize: [22, 22], iconAnchor: [11, 11] });
const fmt = (p: LatLon) => `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;

function fit(map: L.Map, pts: LatLon[]) {
  if (!pts.length) return;
  if (pts.length === 1) map.setView([pts[0].lat, pts[0].lon], 15);
  // Extra room at the top and bottom: the toolbar and the action bar float over the map there.
  else map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { paddingTopLeft: [48, 150], paddingBottomRight: [64, 110], maxZoom: 17 });
}

/** Zoom to the markers once per folder (not after every edit), and again whenever `nonce` changes (Fit button). */
function FitMarkers({ points, folderKey, nonce }: { points: LatLon[]; folderKey: string; nonce: number }) {
  const map = useMap();
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (fittedFor.current === folderKey || !points.length) return;
    fittedFor.current = folderKey;
    fit(map, points);
  }, [map, points, folderKey]);
  useEffect(() => {
    if (nonce) fit(map, points);
    // Only on Fit clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return null;
}

/** Panes resize without a window resize; Leaflet has to be told. */
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ClickToPlace({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  return null;
}

/** Press-and-drag draws a circle (mouse or touch). Map panning is off while this mode is active. */
function DrawCircle({ onDraw, onDone }: { onDraw: (c: Drawn) => void; onDone: (c: Drawn | null, add: boolean) => void }) {
  const map = useMap();
  const cb = useRef({ onDraw, onDone });
  cb.current = { onDraw, onDone };
  useEffect(() => {
    const el = map.getContainer();
    map.dragging.disable();
    map.doubleClickZoom.disable();
    let start: { id: number; at: L.LatLng; x: number; y: number } | null = null;
    const toCircle = (e: PointerEvent): Drawn => {
      const at = start!.at;
      return { center: { lat: at.lat, lon: at.lng }, radius: map.distance(at, map.mouseEventToLatLng(e)) };
    };
    const down = (e: PointerEvent) => {
      if (start || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if ((e.target as HTMLElement).closest('.leaflet-control, .map-toolbar, .map-bar')) return;
      start = { id: e.pointerId, at: map.mouseEventToLatLng(e), x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (start?.id === e.pointerId) cb.current.onDraw(toCircle(e));
    };
    const up = (e: PointerEvent) => {
      if (start?.id !== e.pointerId) return;
      const tiny = Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8;
      const c = toCircle(e);
      start = null;
      cb.current.onDone(tiny || e.type === 'pointercancel' ? null : c, e.shiftKey);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      map.dragging.enable();
      map.doubleClickZoom.enable();
    };
  }, [map]);
  return null;
}

/**
 * The GPS page's center pane: every geotagged file in the folder as a marker, plus tools to
 * place files without GPS (click, or drag from the list) and to circle-select and tighten a scattered cluster.
 */
export function GpsMap({ api }: { api: WorkspaceApi }) {
  const config = useConfig().data;
  const color = useTokens();
  const [map, setMap] = useState<L.Map | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [fitNonce, setFitNonce] = useState(0);
  const [pending, setPending] = useState<(LatLon & { rels: string[] }) | null>(null);
  const [drawing, setDrawing] = useState<Drawn | null>(null);
  const [circle, setCircle] = useState<Drawn | null>(null);
  const [tighten, setTighten] = useState(0);
  const [toward, setToward] = useState<'center' | 'average'>('average');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pointer = useRef('mouse');

  const located = useMemo(() => api.visible.filter((e): e is EnrichedEntry & { meta: { gps: LatLon } } => !!e.meta.gps), [api.visible]);
  const points = useMemo(() => located.map((e) => e.meta.gps), [located]);
  const nSelected = api.selected.length;
  const ref = (rel: string): FileRef => ({ root: api.root, rel });

  // Clear tool state when the folder changes.
  useEffect(() => {
    setPending(null);
    setCircle(null);
    setTighten(0);
  }, [api.folder]);

  const inCircle = useMemo(
    () => (circle ? located.filter((e) => L.latLng(circle.center.lat, circle.center.lon).distanceTo([e.meta.gps.lat, e.meta.gps.lon]) <= circle.radius) : []),
    [circle, located],
  );
  const target = useMemo((): LatLon | null => {
    if (!circle) return null;
    if (toward === 'center' || !inCircle.length) return circle.center;
    return { lat: inCircle.reduce((s, e) => s + e.meta.gps.lat, 0) / inCircle.length, lon: inCircle.reduce((s, e) => s + e.meta.gps.lon, 0) / inCircle.length };
  }, [circle, toward, inCircle]);
  const scale = 1 - tighten / 100;
  const preview = target && tighten > 0 ? inCircle.map((e) => ({ rel: e.rel, from: e.meta.gps, to: gatherPoint(e.meta.gps, target, scale) })) : [];

  const run = async (title: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(`${title}: ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const placeAt = (p: LatLon, rels = [...api.selectedRels]) => {
    if (!rels.length) return;
    setPending({ ...p, rels });
  };

  const applyPlace = async () => {
    if (!pending) return;
    const ok = await run('Set GPS', () =>
      runJobAndWait({
        title: `Set GPS on ${pending.rels.length} file${pending.rels.length === 1 ? '' : 's'}`,
        selection: { files: pending.rels.map(ref) },
        steps: [{ type: 'setGps', lat: pending.lat, lon: pending.lon }],
      }),
    );
    if (ok) setPending(null);
  };

  const applyTighten = async () => {
    if (!target || !inCircle.length) return;
    const ok = await run('Tighten', () =>
      runJobAndWait({
        title: `Tighten ${inCircle.length} GPS positions ${tighten}%`,
        selection: { files: inCircle.map((e) => ref(e.rel)) },
        steps: [{ type: 'gatherGps', lat: target.lat, lon: target.lon, scale }],
      }),
    );
    if (ok) setTighten(0);
  };

  // Drag a row from the file list onto the map: places that file (or the whole selection when it's part of it).
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(REL_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDrop = (e: DragEvent) => {
    const rel = e.dataTransfer.getData(REL_MIME);
    if (!rel || !map) return;
    e.preventDefault();
    const at = map.mouseEventToLatLng(e.nativeEvent);
    let rels = [...api.selectedRels];
    if (!api.selectedRels.has(rel)) {
      rels = [rel];
      api.setSelection(new Set(rels));
    }
    api.focusRel(rel);
    setPending({ lat: at.lat, lon: at.lng, rels });
  };

  const hint =
    mode === 'select'
      ? 'Click a marker to select it. Shift or Cmd/Ctrl adds to the selection.'
      : mode === 'place'
        ? nSelected
          ? `Click the map to place ${nSelected} selected file${nSelected === 1 ? '' : 's'}, or drag a file from the list.`
          : 'Select files in the list (e.g. "No GPS"), then click the map — or drag a file onto the map.'
        : 'Drag on the map to draw a circle; the files inside get selected. Shift adds to the selection.';

  if (!config) return <div className="gps-map-area" />;
  return (
    <div className={`gps-map-area mode-${mode}`} onDragOver={onDragOver} onDrop={onDrop} onPointerDownCapture={(e) => (pointer.current = e.pointerType)}>
      <MapContainer ref={setMap} center={[20, 0]} zoom={2} zoomControl={false} style={{ height: '100%' }}>
        {/* OSM blocks tile requests without a Referer; pin the policy so a proxy's `Referrer-Policy: no-referrer` can't strip it. */}
        <TileLayer url={config.mapTileUrl} attribution={config.mapAttribution} referrerPolicy="strict-origin-when-cross-origin" />
        <ZoomControl position="topright" />
        <TrackSize />
        <FitMarkers points={points} folderKey={`${api.root}:${api.folder}`} nonce={fitNonce} />
        {mode === 'place' && <ClickToPlace onPick={(p) => placeAt(p)} />}
        {mode === 'circle' && (
          <DrawCircle
            onDraw={setDrawing}
            onDone={(c, add) => {
              setDrawing(null);
              if (!c) return;
              setCircle(c);
              setTighten(0);
              const center = L.latLng(c.center.lat, c.center.lon);
              const inside = located.filter((e) => center.distanceTo([e.meta.gps.lat, e.meta.gps.lon]) <= c.radius).map((e) => e.rel);
              api.setSelection(new Set(add ? [...api.selectedRels, ...inside] : inside));
              api.focusRel(inside[0] ?? null);
            }}
          />
        )}

        {/* Unselected first so selected and focused markers draw on top. */}
        {[...located]
          .sort((a, b) => Number(api.selectedRels.has(a.rel)) - Number(api.selectedRels.has(b.rel)) || Number(a.rel === api.focused?.rel) - Number(b.rel === api.focused?.rel))
          .map((e) => {
            const sel = api.selectedRels.has(e.rel);
            const foc = e.rel === api.focused?.rel;
            return (
              <CircleMarker
                // `interactive` can't change after creation: remount when the mode does.
                key={`${e.rel}:${mode}`}
                center={[e.meta.gps.lat, e.meta.gps.lon]}
                radius={foc ? 10 : sel ? 8 : 7}
                interactive={mode === 'select'}
                pathOptions={{
                  // Light OSM tiles: a light dot with a dark ring reads best; selection turns it green.
                  color: foc ? color.ink : color.canvas,
                  weight: foc ? 3 : 2,
                  fillColor: sel || foc ? color.accent : color.ink,
                  fillOpacity: 0.95,
                }}
                eventHandlers={{
                  click: (ev) => {
                    L.DomEvent.stopPropagation(ev);
                    const o = ev.originalEvent;
                    api.pick(e.rel, { shift: o.shiftKey, meta: o.metaKey || o.ctrlKey, touch: pointer.current === 'touch' });
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -6]}>
                  {e.name}
                </Tooltip>
              </CircleMarker>
            );
          })}

        {(drawing ?? circle) && (
          <Circle
            center={[(drawing ?? circle)!.center.lat, (drawing ?? circle)!.center.lon]}
            radius={(drawing ?? circle)!.radius}
            interactive={false}
            pathOptions={{ color: color.accent, weight: 2, dashArray: '6 6', fillColor: color.accent, fillOpacity: 0.08 }}
          />
        )}
        {preview.map((p) => (
          <Polyline key={`l:${p.rel}`} positions={[[p.from.lat, p.from.lon], [p.to.lat, p.to.lon]]} interactive={false} pathOptions={{ color: color.warning, weight: 1, opacity: 0.8 }} />
        ))}
        {preview.map((p) => (
          <CircleMarker
            key={`p:${p.rel}`}
            center={[p.to.lat, p.to.lon]}
            radius={5}
            interactive={false}
            pathOptions={{ color: color.warning, weight: 2, fillOpacity: 0 }}
          />
        ))}
        {target && tighten > 0 && <CircleMarker center={[target.lat, target.lon]} radius={3} interactive={false} pathOptions={{ color: color.warning, fillColor: color.warning, fillOpacity: 1 }} />}

        {pending && (
          <Marker
            position={[pending.lat, pending.lon]}
            icon={pinIcon}
            draggable
            eventHandlers={{
              dragend: (ev) => {
                const ll = (ev.target as L.Marker).getLatLng();
                setPending((p) => p && { ...p, lat: ll.lat, lon: ll.lng });
              },
            }}
          />
        )}
      </MapContainer>

      <div className="map-toolbar">
        <div className="row" style={{ gap: 6 }}>
          <div className="seg">
            {(
              [
                ['select', 'Select'],
                ['place', 'Place'],
                ['circle', 'Circle'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
                {label}
              </button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => setFitNonce((n) => n + 1)} disabled={!points.length}>
            Fit
          </button>
          <div className="map-search">
            <PlaceSearch
              compact
              onPick={(p) => {
                map?.setView([p.lat, p.lon], Math.max(map.getZoom(), 15));
                if (mode === 'place') placeAt(p);
              }}
            />
          </div>
        </div>
        <div className="caption map-hint">{hint}</div>
        {!points.length && api.visible.length > 0 && <div className="caption map-hint warning-text">No file in this folder has GPS yet.</div>}
      </div>

      {(pending || circle || error) && (
        <div className="map-bar">
          {error && <span className="error-text caption grow">{error}</span>}
          {pending && !error && (
            <>
              <span className="grow">
                Set GPS on <strong>{pending.rels.length}</strong> file{pending.rels.length === 1 ? '' : 's'} at <span className="mono">{fmt(pending)}</span>
                <span className="caption muted"> · drag the pin to adjust</span>
              </span>
              <button className="btn btn-sm" onClick={() => setPending(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-sm btn-primary" onClick={applyPlace} disabled={busy}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
            </>
          )}
          {circle && !pending && !error && (
            <>
              <span>
                <strong>{inCircle.length}</strong> in circle
              </span>
              <label className="row caption" style={{ gap: 6 }}>
                Tighten
                <input type="range" min={0} max={100} step={5} value={tighten} onChange={(e) => setTighten(Number(e.target.value))} aria-label="Tighten" />
                <span className="mono" style={{ width: 36 }}>
                  {tighten}%
                </span>
              </label>
              <select className="input input-sm" style={{ width: 'auto' }} value={toward} onChange={(e) => setToward(e.target.value as 'center' | 'average')} aria-label="Toward">
                <option value="average">toward their average</option>
                <option value="center">toward the circle center</option>
              </select>
              <span className="grow" />
              <button className="btn btn-sm" onClick={() => (setCircle(null), setTighten(0))} disabled={busy}>
                Clear circle
              </button>
              <button className="btn btn-sm btn-primary" onClick={applyTighten} disabled={busy || !tighten || !inCircle.length}>
                {busy ? 'Applying…' : 'Apply'}
              </button>
            </>
          )}
          {error && (
            <button className="btn btn-sm" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </div>
  );
}
