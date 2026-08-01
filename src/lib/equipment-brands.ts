/**
 * Per-sport equipment brand seeds — the suggestion list behind the Add
 * Equipment brand/model pickers.
 *
 * ADDING AN EQUIPMENT SPORT = 2 edits:
 *   1. a category list in equipment-config.ts
 *   2. a brand array here (+ optionally spec fields in equipment-specs.ts)
 * No component or API changes. (Mirrors the stat-schemas.ts convention.)
 *
 * WHY SEEDS AND NOT AN API: there is no equipment-catalog API for any sport.
 * Every "sports API" on the market (TheSportsDB, API-Sports, SportsDataIO,
 * Sportmonks) serves scores, fixtures and player stats — nobody sells brands
 * and models. Hotlinking manufacturer catalogs is what produced the 124 dead
 * URLs this replaced, and is a licensing problem besides.
 *
 * These lists are deliberately BRANDS ONLY (plus golf's legacy model list).
 * Brands are ~30 per sport and essentially never change; models are thousands
 * per sport and turn over every season, so a hand-typed model list is a
 * treadmill nobody will run. The long tail is covered by free-text entry —
 * the dropdown suggests, it never constrains — and later by community
 * suggestions (see CommunityFetcher in equipment-catalog.ts).
 */

export interface EquipmentBrand {
  /** Slug, unique within its sport's array. */
  id: string;
  /** Display form — exactly what lands in the input when picked. */
  name: string;
  /** Brand's own domain, used to resolve a logo (see BrandLogo.tsx). */
  domain?: string;
  /** Lowercase alternates athletes actually type. Matched exactly. */
  aliases?: string[];
}

export interface EquipmentModel {
  id: string;
  name: string;
  /** Brand *id*, not display name. */
  brand: string;
  /** Matches a category value in equipment-config.ts for the same sport. */
  category: string;
  year?: number;
}

/**
 * Golf. Carried over verbatim from the original catalog — DO NOT PRUNE.
 * Existing golfers must not lose a brand they can pick today; a test pins
 * the count and spot-checks names. `domain` values were recovered from the
 * dead `logo.clearbit.com/<domain>` URLs deleted in the previous change.
 *
 * Note the "<Brand> Golf" naming (Nike Golf, adidas Golf, …) is intentional
 * and must stay — renaming would stop matching rows athletes already saved.
 */
const GOLF_BRANDS: EquipmentBrand[] = [
  // Major Club Manufacturers
  { id: 'titleist', name: 'Titleist', domain: 'titleist.com' },
  { id: 'taylormade', name: 'TaylorMade', domain: 'taylormadegolf.com', aliases: ['tm'] },
  { id: 'callaway', name: 'Callaway', domain: 'callawaygolf.com' },
  { id: 'ping', name: 'PING', domain: 'ping.com' },
  { id: 'cobra', name: 'Cobra', domain: 'cobragolf.com' },
  { id: 'mizuno', name: 'Mizuno', domain: 'mizunogolf.com' },
  { id: 'srixon', name: 'Srixon', domain: 'srixon.com' },
  { id: 'pxg', name: 'PXG', domain: 'pxg.com' },
  { id: 'cleveland', name: 'Cleveland Golf', domain: 'clevelandgolf.com' },
  { id: 'wilson', name: 'Wilson', domain: 'wilson.com' },
  { id: 'tour-edge', name: 'Tour Edge', domain: 'touredge.com' },
  { id: 'xxio', name: 'XXIO', domain: 'xxiousa.com' },
  { id: 'honma', name: 'Honma', domain: 'honmagolf.com' },
  { id: 'bridgestone', name: 'Bridgestone Golf', domain: 'bridgestonegolf.com' },
  { id: 'yonex', name: 'Yonex', domain: 'yonex.com' },
  { id: 'ben-hogan', name: 'Ben Hogan Golf', domain: 'benhogangolf.com' },
  { id: 'sub-70', name: 'Sub 70', domain: 'sub70.com' },
  { id: 'maltby', name: 'Maltby' },
  { id: 'haywood', name: 'Haywood Golf', domain: 'haywoodgolf.com' },
  { id: 'takomo', name: 'Takomo Golf', domain: 'takomogolf.com' },

  // Putter Specialists
  { id: 'odyssey', name: 'Odyssey', domain: 'odysseygolf.com' },
  { id: 'scotty-cameron', name: 'Scotty Cameron', domain: 'scottycameron.com', aliases: ['scotty'] },
  { id: 'bettinardi', name: 'Bettinardi', domain: 'bettinardi.com' },
  { id: 'evnroll', name: 'Evnroll', domain: 'evnroll.com' },
  { id: 'seemore', name: 'SeeMore', domain: 'seemoreputter.com' },
  { id: 'l-a-b-golf', name: 'L.A.B. Golf', domain: 'labgolf.com', aliases: ['lab'] },
  { id: 'toulon', name: 'Toulon Design', domain: 'toulondesign.com' },
  { id: 'tpo', name: 'TPO Golf' },

  // Golf Ball Brands
  { id: 'vice', name: 'Vice Golf', domain: 'vicegolf.com' },
  { id: 'snell', name: 'Snell Golf', domain: 'snellgolf.com' },
  { id: 'cut', name: 'Cut Golf', domain: 'cutgolf.com' },
  { id: 'seed', name: 'Seed Golf', domain: 'seedgolf.com' },
  { id: 'maxfli', name: 'Maxfli', domain: 'maxfli.com' },
  { id: 'top-flite', name: 'Top Flite' },
  { id: 'inesis', name: 'Inesis' },

  // Wedge Specialists
  { id: 'vokey', name: 'Vokey Design', domain: 'vokey.com' },
  { id: 'artisan', name: 'Artisan Golf', domain: 'artisangolf.com' },

  // Apparel & Shoes
  { id: 'footjoy', name: 'FootJoy', domain: 'footjoy.com', aliases: ['fj'] },
  { id: 'adidas', name: 'adidas Golf', domain: 'adidas.com' },
  { id: 'nike', name: 'Nike Golf', domain: 'nike.com' },
  { id: 'under-armour', name: 'Under Armour Golf', domain: 'underarmour.com', aliases: ['ua'] },
  { id: 'puma', name: 'Puma Golf', domain: 'puma.com' },
  { id: 'ecco', name: 'ECCO Golf', domain: 'ecco.com' },
  { id: 'new-balance', name: 'New Balance Golf', domain: 'newbalance.com', aliases: ['nb'] },
  { id: 'true-linkswear', name: 'True Linkswear', domain: 'truelinkswear.com' },
  { id: 'g-fore', name: 'G/FORE', domain: 'gfore.com' },
  { id: 'travis-mathew', name: 'TravisMathew', domain: 'travismathew.com' },
  { id: 'johnnie-o', name: 'Johnnie-O', domain: 'johnnie-o.com' },
  { id: 'peter-millar', name: 'Peter Millar', domain: 'petermillar.com' },
  { id: 'polo', name: 'Polo Golf', domain: 'ralphlauren.com' },
  { id: 'lululemon', name: 'Lululemon Golf', domain: 'lululemon.com' },

  // Bags
  { id: 'sun-mountain', name: 'Sun Mountain', domain: 'sunmountain.com' },
  { id: 'vessel', name: 'Vessel', domain: 'vesselbags.com' },
  { id: 'jones', name: 'Jones Golf Bags', domain: 'jonessportsco.com' },
  { id: 'ogio', name: 'OGIO', domain: 'ogio.com' },
  { id: 'stitch', name: 'Stitch Golf', domain: 'stitchgolf.com' },
  { id: 'motocaddy', name: 'Motocaddy', domain: 'motocaddy.com' },
  { id: 'big-max', name: 'Big Max', domain: 'bigmaxgolf.com' },
  { id: 'clicgear', name: 'ClicGear', domain: 'clicgear.com' },
  { id: 'bag-boy', name: 'Bag Boy', domain: 'bagboy.com' },

  // Rangefinders & GPS
  { id: 'bushnell', name: 'Bushnell', domain: 'bushnellgolf.com' },
  { id: 'garmin', name: 'Garmin', domain: 'garmin.com' },
  { id: 'leupold', name: 'Leupold', domain: 'leupold.com' },
  { id: 'precision-pro', name: 'Precision Pro Golf', domain: 'precisionprogolf.com' },
  { id: 'blue-tees', name: 'Blue Tees Golf', domain: 'blueteesgolf.com' },
  { id: 'skytrak', name: 'SkyTrak', domain: 'skytrakgolf.com' },
  { id: 'shot-scope', name: 'Shot Scope', domain: 'shotscope.com' },
  { id: 'arccos', name: 'Arccos', domain: 'arccosgolf.com' },

  // Gloves & Accessories
  { id: 'bionic', name: 'Bionic', domain: 'bionicgloves.com' },
  { id: 'zero-friction', name: 'Zero Friction' },
  { id: 'cabretta', name: 'Cabretta' },
  { id: 'asher', name: 'Asher Golf', domain: 'ashergolf.com' },

  // Other/Custom
  { id: 'other', name: 'Other' },
];

/**
 * Brands that make gear across many sports. Spread into each sport's list so
 * a soccer player and a basketball player both see Nike without either list
 * having to repeat the domain.
 *
 * Golf deliberately does NOT use these — it carries its own "Nike Golf" style
 * entries for backward compatibility (see GOLF_BRANDS).
 */
const UNIVERSAL: EquipmentBrand[] = [
  { id: 'nike', name: 'Nike', domain: 'nike.com' },
  { id: 'adidas', name: 'adidas', domain: 'adidas.com' },
  { id: 'under-armour', name: 'Under Armour', domain: 'underarmour.com', aliases: ['ua'] },
  { id: 'puma', name: 'Puma', domain: 'puma.com' },
  { id: 'new-balance', name: 'New Balance', domain: 'newbalance.com', aliases: ['nb'] },
  { id: 'asics', name: 'ASICS', domain: 'asics.com' },
  { id: 'mizuno', name: 'Mizuno', domain: 'mizuno.com' },
];

const ICE_HOCKEY_BRANDS: EquipmentBrand[] = [
  // Sticks, skates, protective
  { id: 'bauer', name: 'Bauer', domain: 'bauer.com' },
  { id: 'ccm', name: 'CCM', domain: 'ccmhockey.com' },
  { id: 'warrior', name: 'Warrior', domain: 'warrior.com' },
  { id: 'true', name: 'TRUE Hockey', domain: 'truetempersports.com' },
  { id: 'sherwood', name: 'Sher-Wood', domain: 'sherwood.ca' },
  { id: 'graf', name: 'Graf', domain: 'grafcanada.com' },
  { id: 'stx', name: 'STX', domain: 'stx.com' },
  { id: 'winnwell', name: 'Winnwell', domain: 'winnwell.com' },
  { id: 'verbero', name: 'Verbero', domain: 'verbero.com' },

  // Goalie
  { id: 'vaughn', name: 'Vaughn', domain: 'vaughnhockey.com' },
  { id: 'brians', name: "Brian's", domain: 'briansgoalie.com' },
  { id: 'bishop', name: 'Bishop', domain: 'bishopcustom.com' },

  // Helmets, visors, eyewear
  { id: 'oakley', name: 'Oakley', domain: 'oakley.com' },
  { id: 'bosport', name: 'Bosport', domain: 'bosport.ca' },

  // Blades, accessories, apparel
  { id: 'bladetech', name: 'Bladetech', domain: 'bladetechhockey.com' },
  { id: 'step-steel', name: 'Step Steel', domain: 'stepsteel.com' },
  { id: 'howies', name: 'Howies', domain: 'howieshockeytape.com' },
  { id: 'a-and-r', name: 'A&R Sports', domain: 'arsports.com' },
  { id: 'elite', name: 'Elite Hockey', domain: 'elitehockey.com' },
  { id: 'grit', name: 'Grit', domain: 'gritinc.com' },
  { id: 'sportube', name: 'Sportube', domain: 'sportube.com' },
  ...UNIVERSAL.filter(b => ['nike', 'adidas', 'under-armour'].includes(b.id)),
  { id: 'other', name: 'Other' },
];

const SOCCER_BRANDS: EquipmentBrand[] = [
  ...UNIVERSAL,
  { id: 'umbro', name: 'Umbro', domain: 'umbro.com' },
  { id: 'diadora', name: 'Diadora', domain: 'diadora.com' },
  { id: 'joma', name: 'Joma', domain: 'joma-sport.com' },
  { id: 'kelme', name: 'Kelme', domain: 'kelme.com' },
  { id: 'lotto', name: 'Lotto', domain: 'lottosport.com' },
  { id: 'kappa', name: 'Kappa', domain: 'kappa.com' },
  { id: 'hummel', name: 'Hummel', domain: 'hummel.net' },
  { id: 'macron', name: 'Macron', domain: 'macron.com' },
  { id: 'concave', name: 'Concave', domain: 'concavesports.com' },

  // Goalkeeper
  { id: 'reusch', name: 'Reusch', domain: 'reusch.com' },
  { id: 'uhlsport', name: 'Uhlsport', domain: 'uhlsport.com' },
  { id: 'storelli', name: 'Storelli', domain: 'storelli.com' },
  { id: 'ho-soccer', name: 'HO Soccer', domain: 'hosoccer.com' },

  // Balls
  { id: 'select', name: 'Select', domain: 'select-sport.com' },
  { id: 'molten', name: 'Molten', domain: 'moltenusa.com' },
  { id: 'mitre', name: 'Mitre', domain: 'mitre.com' },
  { id: 'other', name: 'Other' },
];

const BASKETBALL_BRANDS: EquipmentBrand[] = [
  ...UNIVERSAL,
  { id: 'jordan', name: 'Jordan', domain: 'nike.com' },
  { id: 'spalding', name: 'Spalding', domain: 'spalding.com' },
  { id: 'wilson', name: 'Wilson', domain: 'wilson.com' },
  { id: 'molten', name: 'Molten', domain: 'moltenusa.com' },
  { id: 'and1', name: 'AND1', domain: 'and1.com' },
  { id: 'anta', name: 'ANTA', domain: 'anta.com' },
  { id: 'li-ning', name: 'Li-Ning', domain: 'lining.com' },
  { id: 'converse', name: 'Converse', domain: 'converse.com' },
  { id: 'reebok', name: 'Reebok', domain: 'reebok.com' },
  { id: 'peak', name: 'PEAK', domain: 'peaksport.com' },
  { id: 'mcdavid', name: 'McDavid', domain: 'mcdavidusa.com' },
  { id: 'nivia', name: 'Nivia', domain: 'nivia.co.in' },
  { id: 'other', name: 'Other' },
];

const VOLLEYBALL_BRANDS: EquipmentBrand[] = [
  ...UNIVERSAL,
  { id: 'molten', name: 'Molten', domain: 'moltenusa.com' },
  { id: 'mikasa', name: 'Mikasa', domain: 'mikasasports.com' },
  { id: 'tachikara', name: 'Tachikara', domain: 'tachikara.com' },
  { id: 'baden', name: 'Baden', domain: 'badensports.com' },
  { id: 'wilson', name: 'Wilson', domain: 'wilson.com' },
  { id: 'spalding', name: 'Spalding', domain: 'spalding.com' },
  { id: 'active-ankle', name: 'Active Ankle', domain: 'activeankle.com' },
  { id: 'mcdavid', name: 'McDavid', domain: 'mcdavidusa.com' },
  { id: 'bownet', name: 'Bownet', domain: 'bownetsports.com' },
  { id: 'tandem', name: 'Tandem Sport', domain: 'tandemsport.com' },
  { id: 'ergodyne', name: 'Ergodyne', domain: 'ergodyne.com' },
  { id: 'other', name: 'Other' },
];

const BASEBALL_BRANDS: EquipmentBrand[] = [
  // Bats
  { id: 'louisville-slugger', name: 'Louisville Slugger', domain: 'slugger.com', aliases: ['ls', 'slugger'] },
  { id: 'marucci', name: 'Marucci', domain: 'maruccisports.com' },
  { id: 'demarini', name: 'DeMarini', domain: 'demarini.com' },
  { id: 'easton', name: 'Easton', domain: 'eastonbaseball.com' },
  { id: 'victus', name: 'Victus', domain: 'victussports.com' },
  { id: 'axe', name: 'Axe Bat', domain: 'axebat.com' },
  { id: 'old-hickory', name: 'Old Hickory', domain: 'oldhickorybats.com' },
  { id: 'chandler', name: 'Chandler Bats', domain: 'chandlerbats.com' },

  // Gloves & protective
  { id: 'rawlings', name: 'Rawlings', domain: 'rawlings.com' },
  { id: 'wilson', name: 'Wilson', domain: 'wilson.com' },
  { id: 'nokona', name: 'Nokona', domain: 'nokona.com' },
  { id: 'all-star', name: 'All-Star', domain: 'allstarsports.com' },
  { id: 'evoshield', name: 'EvoShield', domain: 'evoshield.com' },
  { id: 'franklin', name: 'Franklin Sports', domain: 'franklinsports.com' },
  { id: '44-pro', name: '44 Pro Gloves', domain: '44progloves.com' },

  // Cleats & apparel
  ...UNIVERSAL.filter(b => ['nike', 'adidas', 'under-armour', 'new-balance', 'mizuno'].includes(b.id)),
  { id: 'boombah', name: 'Boombah', domain: 'boombah.com' },
  { id: 'other', name: 'Other' },
];

/**
 * Brand suggestions per sport. 'general' is deliberately absent — General
 * items are free text with no dropdown, matching how the category field
 * already behaves for them in equipment-config.ts.
 */
export const BRAND_SEEDS: Record<string, EquipmentBrand[]> = {
  golf: GOLF_BRANDS,
  ice_hockey: ICE_HOCKEY_BRANDS,
  soccer: SOCCER_BRANDS,
  basketball: BASKETBALL_BRANDS,
  volleyball: VOLLEYBALL_BRANDS,
  baseball: BASEBALL_BRANDS,
};

/**
 * Golf's legacy model list, kept so existing golfers keep their autocomplete.
 * No other sport gets one — see the file header for why.
 */
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

export const MODEL_SEEDS: Record<string, EquipmentModel[]> = {
  golf: GOLF_MODELS,
};

/** Seed brands for a sport; empty for 'general' and unknown sports. */
export function getSeedBrands(sportKey: string): EquipmentBrand[] {
  return BRAND_SEEDS[sportKey] ?? [];
}

/** Seed models for a sport; empty for every sport except golf. */
export function getSeedModels(sportKey: string): EquipmentModel[] {
  return MODEL_SEEDS[sportKey] ?? [];
}

/** Placeholder naming brands the athlete will recognise for their sport. */
export function getBrandPlaceholder(sportKey: string): string {
  const names = getSeedBrands(sportKey)
    .filter(b => b.id !== 'other')
    .slice(0, 3)
    .map(b => b.name);
  return names.length > 0 ? `e.g., ${names.join(', ')}` : 'e.g., Nike, adidas, Under Armour';
}

/** Placeholder for the model field. Golf keeps its familiar examples. */
export function getModelPlaceholder(sportKey: string): string {
  return sportKey === 'golf' ? 'e.g., Stealth 2, Pro V1' : 'e.g., model name';
}
