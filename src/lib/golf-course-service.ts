import { searchGolfCourses, getCourseById, getCourseByName, type GolfCourse } from './golf-courses-db';

// Configuration for external APIs (ready for future use)
const API_CONFIG = {
  golfApi: {
    enabled: process.env.GOLF_API_ENABLED === 'true',
    baseUrl: process.env.GOLF_API_BASE_URL || 'https://api.golfapi.io/v1',
    apiKey: process.env.GOLF_API_KEY || '',
  },
  iGolf: {
    enabled: process.env.IGOLF_API_ENABLED === 'true',
    baseUrl: process.env.IGOLF_API_BASE_URL || 'https://api.igolf.com/v1',
    apiKey: process.env.IGOLF_API_KEY || '',
  },
  zylaGolf: {
    enabled: process.env.ZYLA_GOLF_API_ENABLED === 'true',
    baseUrl: process.env.ZYLA_GOLF_API_BASE_URL || 'https://golf-courses-data-api.p.rapidapi.com',
    apiKey: process.env.ZYLA_GOLF_API_KEY || '',
  }
};

// Cache for API results (in-memory for now, could be Redis/DB later)
const apiCache = new Map<string, { data: GolfCourse[], timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface SearchOptions {
  query: string;
  limit?: number;
  useLocalOnly?: boolean;
  country?: string;
  state?: string;
}

interface SearchResult {
  courses: GolfCourse[];
  total: number;
  source: 'local' | 'api' | 'hybrid';
  query: string;
}

// API Response Types
interface GolfApiCourse {
  id?: string;
  name: string;
  city?: string;
  state?: string;
  country?: string;
  coordinates?: { lat: number; lng: number };
  designer?: string;
  yearOpened?: number;
  courseRating?: Record<string, number>;
  slopeRating?: Record<string, number>;
  totalPar?: number;
  totalYardage?: Record<string, number>;
  holes?: unknown;
  features?: string[];
  website?: string;
  imageUrl?: string;
  description?: string;
  greensType?: string;
  priceRange?: string;
}

interface IGolfCourse {
  id?: string;
  courseName?: string;
  name?: string;
  city?: string;
  state?: string;
  province?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  courseRating?: Record<string, number>;
  slopeRating?: Record<string, number>;
  par?: number;
  yardage?: Record<string, number>;
  scorecard?: unknown;
  description?: string;
  greenFee?: number | string;
}

interface ZylaGolfCourse {
  courseName?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  par?: number;
  scorecard?: unknown;
}

type ScorecardData = Array<{ par?: number; yardage?: number; handicap?: number }> | Record<string, string | number>;

/**
 * Hybrid Golf Course Search Service
 *
 * Search Strategy:
 * 1. Search local database first (fast, always available)
 * 2. If insufficient results and API enabled, search external APIs
 * 3. Cache API results for future use
 * 4. Merge and deduplicate results
 */
export class GolfCourseService {

  /**
   * Main search method with hybrid approach
   */
  static async searchCourses(options: SearchOptions): Promise<SearchResult> {
    const { query, limit = 10, useLocalOnly = false } = options;

    // Always search local database first
    const localResults = searchGolfCourses(query, limit);

    // If we have enough local results or API is disabled, return local results
    if (useLocalOnly || localResults.length >= limit || !this.isAnyApiEnabled()) {
      return {
        courses: localResults,
        total: localResults.length,
        source: 'local',
        query
      };
    }

    // Search APIs for additional results
    try {
      const apiResults = await this.searchExternalApis(query, limit - localResults.length, options);

      // Merge and deduplicate results
      const mergedResults = this.mergeResults(localResults, apiResults);

      return {
        courses: mergedResults.slice(0, limit),
        total: mergedResults.length,
        source: apiResults.length > 0 ? 'hybrid' : 'local',
        query
      };
    } catch (error) {
      console.warn('API search failed, falling back to local results:', error);

      return {
        courses: localResults,
        total: localResults.length,
        source: 'local',
        query
      };
    }
  }

  /**
   * Get course by ID (checks local first, then APIs)
   */
  static async getCourseById(id: string): Promise<GolfCourse | null> {
    // Check local database first
    const localCourse = getCourseById(id);
    if (localCourse) {
      return localCourse;
    }

    // If not found locally and APIs are enabled, search APIs
    if (this.isAnyApiEnabled()) {
      try {
        return await this.fetchCourseFromApis(id);
      } catch (error) {
        console.warn('API course fetch failed:', error);
      }
    }

    return null;
  }

  /**
   * Get course by name (checks local first, then APIs)
   */
  static async getCourseByName(name: string): Promise<GolfCourse | null> {
    // Check local database first
    const localCourse = getCourseByName(name);
    if (localCourse) {
      return localCourse;
    }

    // If not found locally, search APIs with exact name match
    if (this.isAnyApiEnabled()) {
      try {
        const apiResults = await this.searchExternalApis(name, 5);
        const exactMatch = apiResults.find(course =>
          course.name.toLowerCase() === name.toLowerCase()
        );
        return exactMatch || null;
      } catch (error) {
        console.warn('API course search failed:', error);
      }
    }

    return null;
  }

  /**
   * Search external APIs (ready for implementation)
   */
  private static async searchExternalApis(
    query: string,
    limit: number,
    options?: SearchOptions
  ): Promise<GolfCourse[]> {

    // Check cache first
    const cacheKey = `search:${query}:${limit}:${options?.country || ''}:${options?.state || ''}`;
    const cached = apiCache.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return cached.data.slice(0, limit);
    }

    const results: GolfCourse[] = [];

    // GolfAPI.io integration (ready for when API key is added)
    if (API_CONFIG.golfApi.enabled && API_CONFIG.golfApi.apiKey) {
      try {
        const golfApiResults = await this.searchGolfApi(query, limit, options);
        results.push(...golfApiResults);
      } catch (error) {
        console.warn('GolfAPI search failed:', error);
      }
    }

    // iGolf Solutions integration (ready for when API key is added)
    if (API_CONFIG.iGolf.enabled && API_CONFIG.iGolf.apiKey && results.length < limit) {
      try {
        const iGolfResults = await this.searchiGolf(query, limit - results.length, options);
        results.push(...iGolfResults);
      } catch (error) {
        console.warn('iGolf search failed:', error);
      }
    }

    // Zyla Golf API integration (ready for when API key is added)
    if (API_CONFIG.zylaGolf.enabled && API_CONFIG.zylaGolf.apiKey && results.length < limit) {
      try {
        const zylaResults = await this.searchZylaGolf(query, limit - results.length);
        results.push(...zylaResults);
      } catch (error) {
        console.warn('Zyla Golf search failed:', error);
      }
    }

    // Cache results
    if (results.length > 0) {
      apiCache.set(cacheKey, { data: results, timestamp: Date.now() });
    }

    return results;
  }

  /**
   * GolfAPI.io search implementation (ready for use)
   */
  private static async searchGolfApi(query: string, limit: number, options?: SearchOptions): Promise<GolfCourse[]> {
    const params = new URLSearchParams({
      q: query,
      limit: limit.toString(),
      ...(options?.country && { country: options.country }),
      ...(options?.state && { state: options.state })
    });

    const response = await fetch(`${API_CONFIG.golfApi.baseUrl}/courses?${params}`, {
      headers: {
        'Authorization': `Bearer ${API_CONFIG.golfApi.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`GolfAPI request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.transformGolfApiResults(data.courses || []);
  }

  /**
   * iGolf Solutions search implementation (ready for use)
   */
  private static async searchiGolf(query: string, limit: number, options?: SearchOptions): Promise<GolfCourse[]> {
    const params = new URLSearchParams({
      search: query,
      limit: limit.toString(),
      format: 'json',
      ...(options?.country && { country: options.country }),
      ...(options?.state && { state: options.state })
    });

    const response = await fetch(`${API_CONFIG.iGolf.baseUrl}/courses?${params}`, {
      headers: {
        'X-API-Key': API_CONFIG.iGolf.apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`iGolf API request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.transformiGolfResults(data.courses || []);
  }

  /**
   * Zyla Golf API search implementation (ready for use)
   */
  private static async searchZylaGolf(query: string, limit: number): Promise<GolfCourse[]> {
    const params = new URLSearchParams({
      courseName: query,
      limit: limit.toString()
    });

    const response = await fetch(`${API_CONFIG.zylaGolf.baseUrl}/courses?${params}`, {
      headers: {
        'X-RapidAPI-Key': API_CONFIG.zylaGolf.apiKey,
        'X-RapidAPI-Host': 'golf-courses-data-api.p.rapidapi.com'
      }
    });

    if (!response.ok) {
      throw new Error(`Zyla Golf API request failed: ${response.status}`);
    }

    const data = await response.json();
    return this.transformZylaResults(data || []);
  }

  /**
   * Fetch single course from APIs by ID
   */
  private static async fetchCourseFromApis(id: string): Promise<GolfCourse | null> {
    // Try each enabled API
    if (API_CONFIG.golfApi.enabled && API_CONFIG.golfApi.apiKey) {
      try {
        const response = await fetch(`${API_CONFIG.golfApi.baseUrl}/courses/${id}`, {
          headers: {
            'Authorization': `Bearer ${API_CONFIG.golfApi.apiKey}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          const transformed = this.transformGolfApiResults([data.course]);
          return transformed[0] || null;
        }
      } catch (error) {
        console.warn('GolfAPI course fetch failed:', error);
      }
    }

    // Add other API lookups here...

    return null;
  }

  /**
   * Transform GolfAPI.io results to our format
   */
  private static transformGolfApiResults(apiResults: GolfApiCourse[]): GolfCourse[] {
    return apiResults.map(course => ({
      id: course.id || `api-${course.name?.toLowerCase().replace(/\s+/g, '-')}`,
      name: course.name,
      location: {
        city: course.city || '',
        state: course.state || '',
        country: course.country || '',
        coordinates: course.coordinates || { lat: 0, lng: 0 }
      },
      designer: course.designer || undefined,
      yearOpened: course.yearOpened || undefined,
      courseRating: course.courseRating || { white: 72 },
      slopeRating: course.slopeRating || { white: 113 },
      totalPar: course.totalPar || 72,
      totalYardage: course.totalYardage || { white: 6000 },
      holes: course.holes && Array.isArray(course.holes) ? this.transformScorecard(course.holes) : this.generateDefaultHoles(),
      features: course.features || [],
      website: course.website || undefined,
      imageUrl: course.imageUrl || undefined,
      description: course.description || '',
      greensType: course.greensType || undefined,
      priceRange: (course.priceRange as 'budget' | 'moderate' | 'premium' | 'luxury' | undefined) || undefined
    }));
  }

  /**
   * Transform iGolf results to our format
   */
  private static transformiGolfResults(apiResults: IGolfCourse[]): GolfCourse[] {
    return apiResults.map((course) => ({
      id: `igolf-${course.id || course.name?.toLowerCase().replace(/\s+/g, '-')}`,
      name: course.courseName || course.name || 'Unknown Course',
      location: {
        city: course.city || '',
        state: course.state || course.province || '',
        country: course.country || '',
        coordinates: {
          lat: course.latitude || 0,
          lng: course.longitude || 0
        }
      },
      courseRating: course.courseRating || { white: 72 },
      slopeRating: course.slopeRating || { white: 113 },
      totalPar: course.par || 72,
      totalYardage: course.yardage || { white: 6000 },
      holes: course.scorecard ? this.transformScorecard(course.scorecard as ScorecardData) : this.generateDefaultHoles(),
      features: [],
      description: course.description || '',
      priceRange: course.greenFee ? (this.mapPriceRange(course.greenFee) as 'budget' | 'moderate' | 'premium' | 'luxury') : undefined
    } as GolfCourse));
  }

  /**
   * Transform Zyla Golf results to our format
   */
  private static transformZylaResults(apiResults: ZylaGolfCourse[]): GolfCourse[] {
    return apiResults.map((course) => ({
      id: `zyla-${course.courseName?.toLowerCase().replace(/\s+/g, '-') || 'unknown'}`,
      name: course.courseName || 'Unknown Course',
      location: {
        city: course.city || '',
        state: course.state || '',
        country: course.country || 'USA',
        coordinates: {
          lat: course.latitude || 0,
          lng: course.longitude || 0
        }
      },
      totalPar: course.par || 72,
      holes: course.scorecard ? this.transformZylaScorecard(course.scorecard as ScorecardData) : this.generateDefaultHoles(),
      features: [],
      description: '',
      priceRange: undefined,
      courseRating: { white: 0 },
      slopeRating: { white: 113 },
      totalYardage: { white: 6000 }
    } as GolfCourse));
  }

  /**
   * Merge local and API results, removing duplicates
   */
  private static mergeResults(local: GolfCourse[], api: GolfCourse[]): GolfCourse[] {
    const merged = [...local];
    const localNames = new Set(local.map(c => c.name.toLowerCase()));

    // Add API results that don't duplicate local ones
    for (const apiCourse of api) {
      if (!localNames.has(apiCourse.name.toLowerCase())) {
        merged.push(apiCourse);
      }
    }

    return merged;
  }

  /**
   * Check if any API is enabled
   */
  private static isAnyApiEnabled(): boolean {
    return Object.values(API_CONFIG).some(config => config.enabled && config.apiKey);
  }

  /**
   * Generate default holes when no hole data is available
   */
  private static generateDefaultHoles() {
    const defaultPars = [4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5];
    return defaultPars.map((par, index) => ({
      number: index + 1,
      par,
      yardage: {
        white: par === 3 ? 150 : par === 4 ? 380 : 520
      },
      handicap: ((index % 18) + 1)
    }));
  }

  /**
   * Transform scorecard data from API format
   */
  private static transformScorecard(scorecard: ScorecardData) {
    if (Array.isArray(scorecard)) {
      return scorecard.map((hole, index) => ({
        number: index + 1,
        par: hole.par || 4,
        yardage: { white: hole.yardage || 400 },
        handicap: hole.handicap || (index + 1)
      }));
    }

    // Handle object format like {"1": "4", "2": "4", ...}
    const holes = [];
    for (let i = 1; i <= 18; i++) {
      const parValue = scorecard[i.toString()];
      const par = typeof parValue === 'number' ? parValue : parseInt(String(parValue)) || 4;
      holes.push({
        number: i,
        par,
        yardage: { white: 400 },
        handicap: i
      });
    }
    return holes;
  }

  /**
   * Transform Zyla scorecard format
   */
  private static transformZylaScorecard(scorecard: ScorecardData) {
    return this.transformScorecard(scorecard);
  }

  /**
   * Map price ranges from API data
   */
  private static mapPriceRange(greenFee: number | string): string {
    if (typeof greenFee === 'number') {
      if (greenFee < 50) return 'budget';
      if (greenFee < 100) return 'moderate';
      if (greenFee < 200) return 'premium';
      return 'luxury';
    }
    return 'unknown';
  }

  /**
   * Clear API cache (useful for development/testing)
   */
  static clearCache(): void {
    apiCache.clear();
  }

  /**
   * Get cache statistics
   */
  static getCacheStats() {
    return {
      size: apiCache.size,
      entries: Array.from(apiCache.keys())
    };
  }
}