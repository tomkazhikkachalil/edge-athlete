/**
 * Equipment Catalog Service
 *
 * This service provides autocomplete suggestions for sports equipment.
 * Currently uses a static catalog but designed to be pluggable with external APIs.
 *
 * Future: Replace with third-party APIs (PGA Value Guide, etc.)
 */

export interface EquipmentBrand {
  id: string;
  name: string;
  logo?: string;
}

export interface EquipmentModel {
  id: string;
  name: string;
  brand: string;
  category: string;
  year?: number;
  image?: string;
}

// Static golf equipment catalog (comprehensive brand list)
//
// No `logo` values: they all pointed at logo.clearbit.com, whose API was
// decommissioned — the domain no longer resolves, so all 66 rendered as
// broken images and cost ~30 failed requests every time the picker opened.
// The optional `logo` field stays on EquipmentBrand as the extension point
// for self-hosted marks; AddEquipmentModal already falls back to an
// initial-letter tile whenever it is absent.
const GOLF_BRANDS: EquipmentBrand[] = [
  // Major Club Manufacturers
  { id: 'titleist', name: 'Titleist' },
  { id: 'taylormade', name: 'TaylorMade' },
  { id: 'callaway', name: 'Callaway' },
  { id: 'ping', name: 'PING' },
  { id: 'cobra', name: 'Cobra' },
  { id: 'mizuno', name: 'Mizuno' },
  { id: 'srixon', name: 'Srixon' },
  { id: 'pxg', name: 'PXG' },
  { id: 'cleveland', name: 'Cleveland Golf' },
  { id: 'wilson', name: 'Wilson' },
  { id: 'tour-edge', name: 'Tour Edge' },
  { id: 'xxio', name: 'XXIO' },
  { id: 'honma', name: 'Honma' },
  { id: 'bridgestone', name: 'Bridgestone Golf' },
  { id: 'yonex', name: 'Yonex' },
  { id: 'ben-hogan', name: 'Ben Hogan Golf' },
  { id: 'sub-70', name: 'Sub 70' },
  { id: 'maltby', name: 'Maltby' },
  { id: 'haywood', name: 'Haywood Golf' },
  { id: 'takomo', name: 'Takomo Golf' },

  // Putter Specialists
  { id: 'odyssey', name: 'Odyssey' },
  { id: 'scotty-cameron', name: 'Scotty Cameron' },
  { id: 'bettinardi', name: 'Bettinardi' },
  { id: 'evnroll', name: 'Evnroll' },
  { id: 'seemore', name: 'SeeMore' },
  { id: 'l-a-b-golf', name: 'L.A.B. Golf' },
  { id: 'toulon', name: 'Toulon Design' },
  { id: 'tpo', name: 'TPO Golf' },

  // Golf Ball Brands
  { id: 'vice', name: 'Vice Golf' },
  { id: 'snell', name: 'Snell Golf' },
  { id: 'cut', name: 'Cut Golf' },
  { id: 'seed', name: 'Seed Golf' },
  { id: 'maxfli', name: 'Maxfli' },
  { id: 'top-flite', name: 'Top Flite' },
  { id: 'inesis', name: 'Inesis' },

  // Wedge Specialists
  { id: 'vokey', name: 'Vokey Design' },
  { id: 'artisan', name: 'Artisan Golf' },

  // Apparel & Shoes
  { id: 'footjoy', name: 'FootJoy' },
  { id: 'adidas', name: 'adidas Golf' },
  { id: 'nike', name: 'Nike Golf' },
  { id: 'under-armour', name: 'Under Armour Golf' },
  { id: 'puma', name: 'Puma Golf' },
  { id: 'ecco', name: 'ECCO Golf' },
  { id: 'new-balance', name: 'New Balance Golf' },
  { id: 'true-linkswear', name: 'True Linkswear' },
  { id: 'g-fore', name: 'G/FORE' },
  { id: 'travis-mathew', name: 'TravisMathew' },
  { id: 'johnnie-o', name: 'Johnnie-O' },
  { id: 'peter-millar', name: 'Peter Millar' },
  { id: 'polo', name: 'Polo Golf' },
  { id: 'lululemon', name: 'Lululemon Golf' },

  // Bags
  { id: 'sun-mountain', name: 'Sun Mountain' },
  { id: 'vessel', name: 'Vessel' },
  { id: 'jones', name: 'Jones Golf Bags' },
  { id: 'ogio', name: 'OGIO' },
  { id: 'stitch', name: 'Stitch Golf' },
  { id: 'motocaddy', name: 'Motocaddy' },
  { id: 'big-max', name: 'Big Max' },
  { id: 'clicgear', name: 'ClicGear' },
  { id: 'bag-boy', name: 'Bag Boy' },

  // Rangefinders & GPS
  { id: 'bushnell', name: 'Bushnell' },
  { id: 'garmin', name: 'Garmin' },
  { id: 'leupold', name: 'Leupold' },
  { id: 'precision-pro', name: 'Precision Pro Golf' },
  { id: 'blue-tees', name: 'Blue Tees Golf' },
  { id: 'skytrak', name: 'SkyTrak' },
  { id: 'shot-scope', name: 'Shot Scope' },
  { id: 'arccos', name: 'Arccos' },

  // Gloves & Accessories
  { id: 'bionic', name: 'Bionic' },
  { id: 'zero-friction', name: 'Zero Friction' },
  { id: 'cabretta', name: 'Cabretta' },
  { id: 'asher', name: 'Asher Golf' },

  // Other/Custom
  { id: 'other', name: 'Other' },
].sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

// Preset images offered in the equipment picker.
//
// This map USED to carry ~110 brand+model product shots hotlinked from
// manufacturer CDNs (titleist.com.au, taylormadegolf.com, ping.com, …). Every
// one of them was dead — probed August 2026, all 124 external URLs in this
// file failed to decode in a real browser (403/404/429, and clearbit's logo
// API no longer resolves at all). The paths had fabricated-looking hashes
// (dw1a2b3c4d, dw5e6f7g8h, …), so they most likely never worked.
//
// They are gone rather than patched: a preset that cannot load is worse than
// no preset, because picking one writes a permanently dead URL into
// athlete_equipment.image_url. `getPresetImages` already falls back to the
// generic entries below, and EquipmentImageUpload already renders a
// "No preset images available" state when the list is empty.
//
// Only the two stock photos that actually load are kept. iron_set, wedge and
// bag are absent on purpose — their photo was the dead one. If real product
// imagery is wanted, host it ourselves (hotlinking manufacturer CDNs is a
// licensing problem even when the URLs work) and add it here.
const MODEL_PRESET_IMAGES: Record<string, string[]> = {
  // Generic fallbacks by category
  'generic-driver': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-fairway_wood': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-hybrid': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-putter': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-ball': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-shoes': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-glove': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-rangefinder': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-other': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
};

const GOLF_MODELS: EquipmentModel[] = [
  // Titleist
  { id: 'tsi2', name: 'TSi2', brand: 'titleist', category: 'driver', year: 2021 },
  { id: 'tsi3', name: 'TSi3', brand: 'titleist', category: 'driver', year: 2021 },
  { id: 'tsr2', name: 'TSR2', brand: 'titleist', category: 'driver', year: 2022 },
  { id: 'tsr3', name: 'TSR3', brand: 'titleist', category: 'driver', year: 2022 },
  { id: 'pro-v1', name: 'Pro V1', brand: 'titleist', category: 'ball' },
  { id: 'pro-v1x', name: 'Pro V1x', brand: 'titleist', category: 'ball' },
  { id: 'ap2', name: 'AP2', brand: 'titleist', category: 'iron_set', year: 2018 },
  { id: 't100', name: 'T100', brand: 'titleist', category: 'iron_set', year: 2023 },
  { id: 't200', name: 'T200', brand: 'titleist', category: 'iron_set', year: 2023 },
  { id: 'vokey-sm9', name: 'Vokey SM9', brand: 'titleist', category: 'wedge', year: 2022 },

  // TaylorMade
  { id: 'stealth-2', name: 'Stealth 2', brand: 'taylormade', category: 'driver', year: 2023 },
  { id: 'stealth', name: 'Stealth', brand: 'taylormade', category: 'driver', year: 2022 },
  { id: 'sim2', name: 'SIM2', brand: 'taylormade', category: 'driver', year: 2021 },
  { id: 'qi10', name: 'Qi10', brand: 'taylormade', category: 'driver', year: 2024 },
  { id: 'tp5', name: 'TP5', brand: 'taylormade', category: 'ball' },
  { id: 'tp5x', name: 'TP5x', brand: 'taylormade', category: 'ball' },
  { id: 'p790', name: 'P790', brand: 'taylormade', category: 'iron_set', year: 2023 },
  { id: 'p7mc', name: 'P7MC', brand: 'taylormade', category: 'iron_set', year: 2022 },
  { id: 'milled-grind-3', name: 'Milled Grind 3', brand: 'taylormade', category: 'wedge', year: 2022 },
  { id: 'spider-gt', name: 'Spider GT', brand: 'taylormade', category: 'putter', year: 2022 },

  // Callaway
  { id: 'paradym', name: 'Paradym', brand: 'callaway', category: 'driver', year: 2023 },
  { id: 'rogue-st', name: 'Rogue ST', brand: 'callaway', category: 'driver', year: 2022 },
  { id: 'epic-speed', name: 'Epic Speed', brand: 'callaway', category: 'driver', year: 2021 },
  { id: 'chrome-soft', name: 'Chrome Soft', brand: 'callaway', category: 'ball' },
  { id: 'chrome-soft-x', name: 'Chrome Soft X', brand: 'callaway', category: 'ball' },
  { id: 'apex-21', name: 'Apex 21', brand: 'callaway', category: 'iron_set', year: 2021 },
  { id: 'paradym-irons', name: 'Paradym', brand: 'callaway', category: 'iron_set', year: 2023 },
  { id: 'jaws-raw', name: 'JAWS Raw', brand: 'callaway', category: 'wedge', year: 2022 },

  // PING
  { id: 'g430-max', name: 'G430 MAX', brand: 'ping', category: 'driver', year: 2023 },
  { id: 'g425', name: 'G425', brand: 'ping', category: 'driver', year: 2021 },
  { id: 'i230', name: 'i230', brand: 'ping', category: 'iron_set', year: 2023 },
  { id: 'i59', name: 'i59', brand: 'ping', category: 'iron_set', year: 2022 },
  { id: 'glide-4', name: 'Glide 4.0', brand: 'ping', category: 'wedge', year: 2022 },

  // Cobra
  { id: 'ltdx', name: 'LTDx', brand: 'cobra', category: 'driver', year: 2022 },
  { id: 'aerojet', name: 'Aerojet', brand: 'cobra', category: 'driver', year: 2023 },
  { id: 'king-forged-tec', name: 'King Forged TEC', brand: 'cobra', category: 'iron_set', year: 2023 },

  // Mizuno
  { id: 'st-z', name: 'ST-Z', brand: 'mizuno', category: 'driver', year: 2021 },
  { id: 'jpx-923', name: 'JPX 923', brand: 'mizuno', category: 'iron_set', year: 2022 },
  { id: 'mp-20', name: 'MP-20', brand: 'mizuno', category: 'iron_set', year: 2020 },
];

/**
 * Search for golf equipment brands
 * Returns all brands if no query, filtered results if query provided
 */
export async function searchGolfBrands(query?: string): Promise<EquipmentBrand[]> {
  // Simulate API delay (remove in production with real API)
  await new Promise(resolve => setTimeout(resolve, 100));

  if (!query || query.length < 1) {
    return GOLF_BRANDS; // Return all brands for dropdown
  }

  const normalized = query.toLowerCase().trim();
  return GOLF_BRANDS.filter(brand =>
    brand.name.toLowerCase().includes(normalized)
  );
}

/**
 * Get all golf brands (for dropdown)
 */
export function getAllGolfBrands(): EquipmentBrand[] {
  return GOLF_BRANDS;
}

/**
 * Search for golf equipment models
 */
export async function searchGolfModels(params: {
  brand?: string;
  category?: string;
  query?: string;
}): Promise<EquipmentModel[]> {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));

  let results = GOLF_MODELS;

  // Filter by brand
  if (params.brand) {
    const brandId = GOLF_BRANDS.find(
      b => b.name.toLowerCase() === params.brand?.toLowerCase()
    )?.id;
    if (brandId) {
      results = results.filter(m => m.brand === brandId);
    }
  }

  // Filter by category
  if (params.category) {
    results = results.filter(m => m.category === params.category);
  }

  // Filter by search query
  if (params.query && params.query.length > 0) {
    const normalized = params.query.toLowerCase().trim();
    results = results.filter(m =>
      m.name.toLowerCase().includes(normalized)
    );
  }

  return results.slice(0, 10);
}

/**
 * Get brand by name
 */
export function getGolfBrandByName(name: string): EquipmentBrand | undefined {
  return GOLF_BRANDS.find(
    b => b.name.toLowerCase() === name.toLowerCase()
  );
}

/**
 * Get preset images for specific brand + model combination
 * Falls back to generic category images if no model-specific images found
 */
export function getPresetImages(brand: string, model: string, category: string): string[] {
  if (!brand || !model) {
    // No brand/model selected yet, return generic category images
    return MODEL_PRESET_IMAGES[`generic-${category}`] || [];
  }

  // Create lookup key: "brand-model" (lowercase, normalized)
  const brandNormalized = brand.toLowerCase().trim();
  const modelNormalized = model.toLowerCase().trim();
  const lookupKey = `${brandNormalized}-${modelNormalized}`;

  // Try exact match first
  const exactMatch = MODEL_PRESET_IMAGES[lookupKey];
  if (exactMatch && exactMatch.length > 0) {
    return exactMatch;
  }

  // Fallback to generic category images
  return MODEL_PRESET_IMAGES[`generic-${category}`] || [];
}

/**
 * Equipment Catalog Service Interface
 * This abstraction allows us to swap in different APIs for different sports
 */
export interface EquipmentCatalogService {
  searchBrands(query: string): Promise<EquipmentBrand[]>;
  searchModels(params: {
    brand?: string;
    category?: string;
    query?: string;
  }): Promise<EquipmentModel[]>;
}

/**
 * Get catalog service for a specific sport
 */
export function getCatalogService(sport: string): EquipmentCatalogService {
  switch (sport) {
    case 'golf':
      return {
        searchBrands: searchGolfBrands,
        searchModels: searchGolfModels,
      };
    default:
      // Return empty catalog for unsupported sports (fallback to manual entry)
      return {
        searchBrands: async () => [],
        searchModels: async () => [],
      };
  }
}
