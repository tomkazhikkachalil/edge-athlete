// ── The app's map tile layers — ONE source for every Leaflet map ───────────
// OpenStreetMap raster (its usage policy requires the attribution) and Esri
// World Imagery via the public tile endpoint with Esri's full attribution
// line (the clean long-term path is Esri's free-tier API key — DEVLOG).
// CSP: img-src allows https:, so both hosts load without a CSP change.

export interface TileLayerDef {
  url: string;
  maxZoom: number;
  attribution: string;
}

export const OSM_TILES: TileLayerDef = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};

export const SATELLITE_TILES: TileLayerDef = {
  url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
};
