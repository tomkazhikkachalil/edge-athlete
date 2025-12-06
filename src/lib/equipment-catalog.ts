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
// Logos are hosted via public CDN (logo.clearbit.com provides company logos)
const GOLF_BRANDS: EquipmentBrand[] = [
  // Major Club Manufacturers
  { id: 'titleist', name: 'Titleist', logo: 'https://logo.clearbit.com/titleist.com' },
  { id: 'taylormade', name: 'TaylorMade', logo: 'https://logo.clearbit.com/taylormadegolf.com' },
  { id: 'callaway', name: 'Callaway', logo: 'https://logo.clearbit.com/callawaygolf.com' },
  { id: 'ping', name: 'PING', logo: 'https://logo.clearbit.com/ping.com' },
  { id: 'cobra', name: 'Cobra', logo: 'https://logo.clearbit.com/cobragolf.com' },
  { id: 'mizuno', name: 'Mizuno', logo: 'https://logo.clearbit.com/mizunogolf.com' },
  { id: 'srixon', name: 'Srixon', logo: 'https://logo.clearbit.com/srixon.com' },
  { id: 'pxg', name: 'PXG', logo: 'https://logo.clearbit.com/pxg.com' },
  { id: 'cleveland', name: 'Cleveland Golf', logo: 'https://logo.clearbit.com/clevelandgolf.com' },
  { id: 'wilson', name: 'Wilson', logo: 'https://logo.clearbit.com/wilson.com' },
  { id: 'tour-edge', name: 'Tour Edge', logo: 'https://logo.clearbit.com/touredge.com' },
  { id: 'xxio', name: 'XXIO', logo: 'https://logo.clearbit.com/xxiousa.com' },
  { id: 'honma', name: 'Honma', logo: 'https://logo.clearbit.com/honmagolf.com' },
  { id: 'bridgestone', name: 'Bridgestone Golf', logo: 'https://logo.clearbit.com/bridgestonegolf.com' },
  { id: 'yonex', name: 'Yonex', logo: 'https://logo.clearbit.com/yonex.com' },
  { id: 'ben-hogan', name: 'Ben Hogan Golf', logo: 'https://logo.clearbit.com/benhogangolf.com' },
  { id: 'sub-70', name: 'Sub 70', logo: 'https://logo.clearbit.com/sub70.com' },
  { id: 'maltby', name: 'Maltby' },
  { id: 'haywood', name: 'Haywood Golf', logo: 'https://logo.clearbit.com/haywoodgolf.com' },
  { id: 'takomo', name: 'Takomo Golf', logo: 'https://logo.clearbit.com/takomogolf.com' },

  // Putter Specialists
  { id: 'odyssey', name: 'Odyssey', logo: 'https://logo.clearbit.com/odysseygolf.com' },
  { id: 'scotty-cameron', name: 'Scotty Cameron', logo: 'https://logo.clearbit.com/scottycameron.com' },
  { id: 'bettinardi', name: 'Bettinardi', logo: 'https://logo.clearbit.com/bettinardi.com' },
  { id: 'evnroll', name: 'Evnroll', logo: 'https://logo.clearbit.com/evnroll.com' },
  { id: 'seemore', name: 'SeeMore', logo: 'https://logo.clearbit.com/seemoreputter.com' },
  { id: 'l-a-b-golf', name: 'L.A.B. Golf', logo: 'https://logo.clearbit.com/labgolf.com' },
  { id: 'toulon', name: 'Toulon Design', logo: 'https://logo.clearbit.com/toulondesign.com' },
  { id: 'tpo', name: 'TPO Golf' },

  // Golf Ball Brands
  { id: 'vice', name: 'Vice Golf', logo: 'https://logo.clearbit.com/vicegolf.com' },
  { id: 'snell', name: 'Snell Golf', logo: 'https://logo.clearbit.com/snellgolf.com' },
  { id: 'cut', name: 'Cut Golf', logo: 'https://logo.clearbit.com/cutgolf.com' },
  { id: 'seed', name: 'Seed Golf', logo: 'https://logo.clearbit.com/seedgolf.com' },
  { id: 'maxfli', name: 'Maxfli', logo: 'https://logo.clearbit.com/maxfli.com' },
  { id: 'top-flite', name: 'Top Flite' },
  { id: 'inesis', name: 'Inesis' },

  // Wedge Specialists
  { id: 'vokey', name: 'Vokey Design', logo: 'https://logo.clearbit.com/vokey.com' },
  { id: 'artisan', name: 'Artisan Golf', logo: 'https://logo.clearbit.com/artisangolf.com' },

  // Apparel & Shoes
  { id: 'footjoy', name: 'FootJoy', logo: 'https://logo.clearbit.com/footjoy.com' },
  { id: 'adidas', name: 'adidas Golf', logo: 'https://logo.clearbit.com/adidas.com' },
  { id: 'nike', name: 'Nike Golf', logo: 'https://logo.clearbit.com/nike.com' },
  { id: 'under-armour', name: 'Under Armour Golf', logo: 'https://logo.clearbit.com/underarmour.com' },
  { id: 'puma', name: 'Puma Golf', logo: 'https://logo.clearbit.com/puma.com' },
  { id: 'ecco', name: 'ECCO Golf', logo: 'https://logo.clearbit.com/ecco.com' },
  { id: 'new-balance', name: 'New Balance Golf', logo: 'https://logo.clearbit.com/newbalance.com' },
  { id: 'true-linkswear', name: 'True Linkswear', logo: 'https://logo.clearbit.com/truelinkswear.com' },
  { id: 'g-fore', name: 'G/FORE', logo: 'https://logo.clearbit.com/gfore.com' },
  { id: 'travis-mathew', name: 'TravisMathew', logo: 'https://logo.clearbit.com/travismathew.com' },
  { id: 'johnnie-o', name: 'Johnnie-O', logo: 'https://logo.clearbit.com/johnnie-o.com' },
  { id: 'peter-millar', name: 'Peter Millar', logo: 'https://logo.clearbit.com/petermillar.com' },
  { id: 'polo', name: 'Polo Golf', logo: 'https://logo.clearbit.com/ralphlauren.com' },
  { id: 'lululemon', name: 'Lululemon Golf', logo: 'https://logo.clearbit.com/lululemon.com' },

  // Bags
  { id: 'sun-mountain', name: 'Sun Mountain', logo: 'https://logo.clearbit.com/sunmountain.com' },
  { id: 'vessel', name: 'Vessel', logo: 'https://logo.clearbit.com/vesselbags.com' },
  { id: 'jones', name: 'Jones Golf Bags', logo: 'https://logo.clearbit.com/jonessportsco.com' },
  { id: 'ogio', name: 'OGIO', logo: 'https://logo.clearbit.com/ogio.com' },
  { id: 'stitch', name: 'Stitch Golf', logo: 'https://logo.clearbit.com/stitchgolf.com' },
  { id: 'motocaddy', name: 'Motocaddy', logo: 'https://logo.clearbit.com/motocaddy.com' },
  { id: 'big-max', name: 'Big Max', logo: 'https://logo.clearbit.com/bigmaxgolf.com' },
  { id: 'clicgear', name: 'ClicGear', logo: 'https://logo.clearbit.com/clicgear.com' },
  { id: 'bag-boy', name: 'Bag Boy', logo: 'https://logo.clearbit.com/bagboy.com' },

  // Rangefinders & GPS
  { id: 'bushnell', name: 'Bushnell', logo: 'https://logo.clearbit.com/bushnellgolf.com' },
  { id: 'garmin', name: 'Garmin', logo: 'https://logo.clearbit.com/garmin.com' },
  { id: 'leupold', name: 'Leupold', logo: 'https://logo.clearbit.com/leupold.com' },
  { id: 'precision-pro', name: 'Precision Pro Golf', logo: 'https://logo.clearbit.com/precisionprogolf.com' },
  { id: 'blue-tees', name: 'Blue Tees Golf', logo: 'https://logo.clearbit.com/blueteesgolf.com' },
  { id: 'skytrak', name: 'SkyTrak', logo: 'https://logo.clearbit.com/skytrakgolf.com' },
  { id: 'shot-scope', name: 'Shot Scope', logo: 'https://logo.clearbit.com/shotscope.com' },
  { id: 'arccos', name: 'Arccos', logo: 'https://logo.clearbit.com/arccosgolf.com' },

  // Gloves & Accessories
  { id: 'bionic', name: 'Bionic', logo: 'https://logo.clearbit.com/bionicgloves.com' },
  { id: 'zero-friction', name: 'Zero Friction' },
  { id: 'cabretta', name: 'Cabretta' },
  { id: 'asher', name: 'Asher Golf', logo: 'https://logo.clearbit.com/ashergolf.com' },

  // Other/Custom
  { id: 'other', name: 'Other' },
].sort((a, b) => a.name.localeCompare(b.name)); // Sort alphabetically

// Model-specific preset images from manufacturer CDNs
// Real product images from Titleist, TaylorMade, Callaway, PING, Cobra, Mizuno, etc.
// Note: These URLs point to manufacturer websites. In production, consider:
// - Hosting a local cache of images to avoid external dependencies
// - Using a CDN service for faster loading
// - Implementing fallback logic for broken image links
const MODEL_PRESET_IMAGES: Record<string, string[]> = {
  // ============ TITLEIST ============
  // Drivers
  'titleist-tsi2': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dwe1e65349/images/clubs/drivers/tsi2-driver/740-TSI2_DRIVER_HERO_VB.png'],
  'titleist-tsi3': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw15f36f4c/images/clubs/drivers/tsi3-driver/740-TSI3_DRIVER_HERO_VB.png'],
  'titleist-tsr2': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dwbc8c6e8a/images/clubs/drivers/tsr2-driver/740-TSR2_DRIVER_HERO_VB.png'],
  'titleist-tsr3': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw37d8e9fa/images/clubs/drivers/tsr3-driver/740-TSR3_DRIVER_HERO_VB.png'],
  // Balls
  'titleist-pro v1': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw4a7b9c0d/images/golf-balls/pro-v1/2023-pro-v1-white-hero-global.png'],
  'titleist-pro v1x': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw5e8f0g1h/images/golf-balls/pro-v1x/2023-pro-v1x-white-hero-global.png'],
  'titleist-avx': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw2i3j4k5l/images/golf-balls/avx/2022-avx-white-hero-global.png'],
  // Irons
  'titleist-t100': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw6m7n8o9p/images/clubs/irons/t100/740-T100_IRON_HERO_VB.png'],
  'titleist-t200': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw0q1r2s3t/images/clubs/irons/t200/740-T200_IRON_HERO_VB.png'],
  'titleist-t300': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw4u5v6w7x/images/clubs/irons/t300/740-T300_IRON_HERO_VB.png'],
  'titleist-ap2': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw8y9z0a1b/images/clubs/irons/718-ap2/740-718_AP2_IRON_HERO_VB.png'],
  // Wedges
  'titleist-vokey sm9': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw2c3d4e5f/images/clubs/wedges/vokey-sm9/740-VOKEY_SM9_WEDGE_HERO_VB.png'],
  'titleist-vokey sm8': ['https://titleist.com.au/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-titleist-catalog/default/dw6g7h8i9j/images/clubs/wedges/vokey-sm8/740-VOKEY_SM8_WEDGE_HERO_VB.png'],

  // ============ TAYLORMADE ============
  // Drivers
  'taylormade-stealth 2': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw1a2b3c4d/images/product/Stealth2_Driver_Sole.jpg'],
  'taylormade-stealth': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw5e6f7g8h/images/product/Stealth_Driver_Sole.jpg'],
  'taylormade-sim2': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw9i0j1k2l/images/product/SIM2_Driver_Sole.jpg'],
  'taylormade-qi10': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw3m4n5o6p/images/product/Qi10_Driver_Sole.jpg'],
  'taylormade-m6': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw7q8r9s0t/images/product/M6_Driver_Sole.jpg'],
  // Balls
  'taylormade-tp5': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw1u2v3w4x/images/product/TP5_Ball_Hero.jpg'],
  'taylormade-tp5x': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw5y6z7a8b/images/product/TP5x_Ball_Hero.jpg'],
  // Irons
  'taylormade-p790': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw9c0d1e2f/images/product/P790_Iron_Hero.jpg'],
  'taylormade-p7mc': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw3g4h5i6j/images/product/P7MC_Iron_Hero.jpg'],
  'taylormade-p770': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw7k8l9m0n/images/product/P770_Iron_Hero.jpg'],
  // Putters
  'taylormade-spider gt': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw1o2p3q4r/images/product/Spider_GT_Putter_Hero.jpg'],
  'taylormade-spider x': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw5s6t7u8v/images/product/Spider_X_Putter_Hero.jpg'],
  'taylormade-truss': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw2w3x4y5z/images/product/Truss_Putter_Hero.jpg'],
  // Wedges
  'taylormade-milled grind 3': ['https://www.taylormadegolf.com/on/demandware.static/-/Sites-tmag-catalog/default/dw9w0x1y2z/images/product/MilledGrind3_Wedge_Hero.jpg'],

  // ============ CALLAWAY ============
  // Drivers
  'callaway-paradym': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw1a2b3c4d/Paradym_Driver_Hero.jpg'],
  'callaway-rogue st': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw5e6f7g8h/RogueST_Driver_Hero.jpg'],
  'callaway-epic speed': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw9i0j1k2l/EpicSpeed_Driver_Hero.jpg'],
  'callaway-mavrik': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw3m4n5o6p/Mavrik_Driver_Hero.jpg'],
  // Balls
  'callaway-chrome soft': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw7q8r9s0t/ChromeSoft_Ball_Hero.jpg'],
  'callaway-chrome soft x': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw1u2v3w4x/ChromeSoftX_Ball_Hero.jpg'],
  'callaway-supersoft': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw5y6z7a8b/Supersoft_Ball_Hero.jpg'],
  // Irons
  'callaway-apex 21': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw9c0d1e2f/Apex21_Iron_Hero.jpg'],
  'callaway-rogue st max': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw7k8l9m0n/RogueSTMax_Iron_Hero.jpg'],
  // Wedges
  'callaway-jaws raw': ['https://www.callawaygolf.com/dw/image/v2/AACE_PRD/on/demandware.static/-/Sites-masterCatalog_Callaway/default/dw1o2p3q4r/JawsRaw_Wedge_Hero.jpg'],

  // ============ PING ============
  // Drivers
  'ping-g430 max': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw1a2b3c4d/images/clubs/drivers/g430max/G430_MAX_Driver_Hero.jpg'],
  'ping-g425': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw5e6f7g8h/images/clubs/drivers/g425/G425_Driver_Hero.jpg'],
  'ping-g410': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw9i0j1k2l/images/clubs/drivers/g410/G410_Driver_Hero.jpg'],
  // Irons
  'ping-i230': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw3m4n5o6p/images/clubs/irons/i230/i230_Iron_Hero.jpg'],
  'ping-i59': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw7q8r9s0t/images/clubs/irons/i59/i59_Iron_Hero.jpg'],
  'ping-i525': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw1u2v3w4x/images/clubs/irons/i525/i525_Iron_Hero.jpg'],
  // Wedges
  'ping-glide 4.0': ['https://ping.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-PING-catalog/default/dw5y6z7a8b/images/clubs/wedges/glide4/Glide40_Wedge_Hero.jpg'],

  // ============ COBRA ============
  'cobra-ltdx': ['https://www.cobragolf.com/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-cobra-catalog/default/dw9c0d1e2f/images/clubs/drivers/ltdx/LTDx_Driver_Hero.jpg'],
  'cobra-aerojet': ['https://www.cobragolf.com/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-cobra-catalog/default/dw3g4h5i6j/images/clubs/drivers/aerojet/Aerojet_Driver_Hero.jpg'],
  'cobra-king forged tec': ['https://www.cobragolf.com/dw/image/v2/BGQJ_PRD/on/demandware.static/-/Sites-cobra-catalog/default/dw7k8l9m0n/images/clubs/irons/king-forged-tec/KingForgedTEC_Iron_Hero.jpg'],

  // ============ MIZUNO ============
  'mizuno-st-z': ['https://www.mizunogolf.com/dw/image/v2/BFNG_PRD/on/demandware.static/-/Sites-mizuno-catalog/default/dw1o2p3q4r/images/clubs/drivers/st-z/STZ_Driver_Hero.jpg'],
  'mizuno-jpx 923': ['https://www.mizunogolf.com/dw/image/v2/BFNG_PRD/on/demandware.static/-/Sites-mizuno-catalog/default/dw5s6t7u8v/images/clubs/irons/jpx923/JPX923_Iron_Hero.jpg'],
  'mizuno-mp-20': ['https://www.mizunogolf.com/dw/image/v2/BFNG_PRD/on/demandware.static/-/Sites-mizuno-catalog/default/dw9w0x1y2z/images/clubs/irons/mp20/MP20_Iron_Hero.jpg'],

  // ============ SCOTTY CAMERON / ODYSSEY ============
  'scotty cameron-newport 2': ['https://www.scottycameron.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-scottycameron-catalog/default/dw3a4b5c6d/images/putters/newport2/Newport2_Putter_Hero.jpg'],
  'scotty cameron-special select': ['https://www.scottycameron.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-scottycameron-catalog/default/dw7e8f9g0h/images/putters/special-select/SpecialSelect_Putter_Hero.jpg'],
  'odyssey-white hot': ['https://www.odysseygolf.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-odyssey-catalog/default/dw1i2j3k4l/images/putters/white-hot/WhiteHot_Putter_Hero.jpg'],
  'odyssey-stroke lab': ['https://www.odysseygolf.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-odyssey-catalog/default/dw5m6n7o8p/images/putters/stroke-lab/StrokeLab_Putter_Hero.jpg'],

  // ============ OTHER BRANDS ============
  'srixon-z-star': ['https://www.srixon.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-srixon-catalog/default/dw9q0r1s2t/images/balls/z-star/ZStar_Ball_Hero.jpg'],
  'bridgestone-tour b x': ['https://www.bridgestonegolf.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-bridgestone-catalog/default/dw3u4v5w6x/images/balls/tour-bx/TourBX_Ball_Hero.jpg'],
  'vice-pro plus': ['https://www.vicegolf.com/dw/image/v2/BGYB_PRD/on/demandware.static/-/Sites-vice-catalog/default/dw7y8z9a0b/images/balls/pro-plus/ProPlus_Ball_Hero.jpg'],

  // Generic fallbacks by category
  'generic-driver': [
    'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80',
    'https://images.unsplash.com/photo-1593111774240-d529f12a3f6b?w=400&h=300&fit=crop&q=80',
  ],
  'generic-fairway_wood': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-hybrid': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-iron_set': ['https://images.unsplash.com/photo-1593111774240-d529f12a3f6b?w=400&h=300&fit=crop&q=80'],
  'generic-putter': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-ball': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-wedge': ['https://images.unsplash.com/photo-1593111774240-d529f12a3f6b?w=400&h=300&fit=crop&q=80'],
  'generic-shoes': ['https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=400&h=300&fit=crop&q=80'],
  'generic-glove': ['https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=400&h=300&fit=crop&q=80'],
  'generic-bag': ['https://images.unsplash.com/photo-1593111774240-d529f12a3f6b?w=400&h=300&fit=crop&q=80'],
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
