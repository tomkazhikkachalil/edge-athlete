/**
 * Design Token System
 * 
 * Centralized design system tokens that ensure visual consistency across all sports.
 * All components must use these tokens instead of hardcoded values.
 * 
 * GUARDRAILS:
 * - Fixed slot heights regardless of sport
 * - Consistent typography scale (32/24/18/16/14/12)
 * - Standardized icon sizes (24/20/16/20)
 * - Spacing rhythm locked to 12/24/48px
 * - Color tokens come from Sport Registry
 */

import type { SportKey } from './sports/SportRegistry';
import { getSportDefinition } from './sports/SportRegistry';

// Typography Scale (matches CSS custom properties)
export const TYPOGRAPHY = {
  H1: {
    size: '2rem', // 32px - Athlete name, primary headers
    weight: '700',
    lineHeight: '1.4'
  },
  H2: {
    size: '1.5rem', // 24px - Section titles 
    weight: '600',
    lineHeight: '1.4'
  },
  H3: {
    size: '1.125rem', // 18px - Card titles, subsection headers
    weight: '700', 
    lineHeight: '1.4'
  },
  BODY: {
    size: '1rem', // 16px - Standard body text
    weight: '400',
    lineHeight: '1.4'
  },
  LABEL: {
    size: '0.875rem', // 14px - Form labels, secondary info
    weight: '400',
    lineHeight: '1.4'
  },
  CHIP: {
    size: '0.75rem', // 12px - Badges, chips, meta info
    weight: '500',
    lineHeight: '1.4'
  }
} as const;

// Icon Sizing (matches CSS custom properties)
export const ICONS = {
  HEADER: '1.5rem', // 24px - Sport icons in card headers
  EDIT: '1.25rem',   // 20px - Edit pencil icons, action buttons
  SOCIAL: '1.25rem', // 20px - Social media icons
  FOOTER: '1rem',    // 16px - Footer/decorative icons in cards
  GAP: '0.5rem'      // 8px - Standard gap between icon and text
} as const;

// Spacing Rhythm (matches CSS custom properties)
export const SPACING = {
  MICRO: '12px',   // ½ base - micro spacing, label gaps, icon margins
  BASE: '24px',    // 1x base - standard gaps, card padding  
  SECTION: '48px'  // 2x base - major sections, page regions
} as const;

// Layout Constants (enforces consistent slot heights)
export const LAYOUT = {
  CARD: {
    MIN_HEIGHT: '280px',      // Fixed minimum card height
    HEADER_HEIGHT: '80px',    // Fixed header: icon + title + chips
    HEADER_TOP: '48px',       // Icon + title + edit button area
    CHIPS_HEIGHT: '20px',     // Chip/badge row height
    FOOTER_HEIGHT: '32px',    // Fixed footer height
    STATS_MIN_HEIGHT: '140px' // Remaining flexible space for stats
  },
  TABLE: {
    HEADER_HEIGHT: '48px',    // Fixed table header height
    ROW_HEIGHT: '44px',       // Minimum row height for consistency
    CELL_PADDING: SPACING.MICRO // Consistent cell padding
  },
  BUTTON: {
    MIN_HEIGHT: '44px',       // Minimum touch target
    MIN_WIDTH: '44px'         // Square buttons (icons)
  },
  CHIP: {
    HEIGHT: '20px',           // Fixed chip height
    BORDER_RADIUS: '10px',    // Half of height for pill shape
    PADDING: '0 8px',         // Horizontal padding
    MAX_WIDTH: '80px'         // Prevents overflow in tight spaces
  }
} as const;

// Sport Color System (integrates with Sport Registry)
export const SPORT_COLORS = {
  /**
   * Get standardized color classes for a sport
   * Uses brand_color_token from Sport Registry
   */
  getColorClasses: (sportKey: SportKey) => {
    const sportDef = getSportDefinition(sportKey);
    const colorToken = sportDef.brand_color_token;
    
    return {
      // Card/container styles
      cardBorder: `border-${colorToken}-200`,
      cardBackground: `bg-${colorToken}-50`,
      
      // Icon colors  
      iconPrimary: `text-${colorToken}-600`,
      iconSecondary: `text-${colorToken}-400`,
      
      // Button styles
      buttonPrimary: `bg-${colorToken}-600 hover:bg-${colorToken}-700 text-white`,
      buttonSecondary: `text-${colorToken}-600 hover:text-${colorToken}-800`,
      
      // Text colors
      textPrimary: `text-${colorToken}-600`,
      textSecondary: `text-${colorToken}-500`,
      
      // State indicators
      activeBorder: `border-${colorToken}-500`,
      activeBackground: `bg-${colorToken}-100`,
      activeText: `text-${colorToken}-700`,
      
      // Raw token for dynamic usage
      token: colorToken
    };
  },

  /**
   * Get neutral colors for disabled/inactive states
   */
  NEUTRAL: {
    cardBorder: 'border-gray-200',
    cardBackground: 'bg-gray-50',
    iconPrimary: 'text-gray-400',
    iconSecondary: 'text-gray-300',
    buttonPrimary: 'bg-gray-100 text-gray-500 cursor-not-allowed',
    buttonSecondary: 'text-gray-400 cursor-not-allowed',
    textPrimary: 'text-gray-500',
    textSecondary: 'text-gray-400',
    activeBorder: 'border-gray-300',
    activeBackground: 'bg-gray-100',
    activeText: 'text-gray-600',
    token: 'gray'
  }
} as const;

// Utility class mappings (for components using CSS classes)
export const CSS_CLASSES = {
  // Typography
  TYPOGRAPHY: {
    H1: 'text-h1',
    H2: 'text-h2', 
    H3: 'text-h3',
    BODY: 'text-body',
    LABEL: 'text-label',
    CHIP: 'text-chip'
  },
  
  // Icons
  ICONS: {
    HEADER: 'icon-header',
    EDIT: 'icon-edit',
    SOCIAL: 'icon-social', 
    FOOTER: 'icon-footer',
    GAP: 'icon-gap',
    BASELINE: 'icon-baseline'
  },
  
  // Spacing
  SPACING: {
    MARGIN: {
      MICRO: 'm-micro',
      BASE: 'm-base',
      SECTION: 'm-section'
    },
    PADDING: {
      MICRO: 'p-micro',
      BASE: 'p-base',
      SECTION: 'p-section'
    },
    GAP: {
      MICRO: 'gap-micro',
      BASE: 'gap-base',
      SECTION: 'gap-section'
    }
  },
  
  // Layout
  LAYOUT: {
    CARD: 'season-card',
    CARD_HEADER: 'season-card-header',
    CARD_STATS: 'season-card-stats',
    CARD_FOOTER: 'season-card-footer',
    CHIP: 'season-chip',
    STAT_TILE: 'stat-tile',
    STAT_VALUE: 'stat-value',
    STAT_LABEL: 'stat-label'
  }
} as const;

// Validation helpers for development
export const DESIGN_VALIDATION = {
  /**
   * Validate that a component is using approved spacing values
   */
  isValidSpacing: (value: string): boolean => {
    const validSpacing = ['12px', '24px', '48px', '0px'];
    return validSpacing.includes(value);
  },
  
  /**
   * Validate that a component is using approved typography sizes
   */
  isValidTypographySize: (size: string): boolean => {
    const validSizes = ['32px', '24px', '18px', '16px', '14px', '12px'];
    return validSizes.includes(size);
  },
  
  /**
   * Validate that a component is using approved icon sizes
   */
  isValidIconSize: (size: string): boolean => {
    const validSizes = ['24px', '20px', '16px'];
    return validSizes.includes(size);
  },
  
  /**
   * Log design system usage for debugging
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  logDesignUsage: (_componentName: string, _usedTokens: string[]) => {
    if (process.env.NODE_ENV === 'development') {
      // Design system tokens used
    }
  }
} as const;

// Export helper functions
export function getSportColorClasses(sportKey: SportKey) {
  return SPORT_COLORS.getColorClasses(sportKey);
}

export function getNeutralColorClasses() {
  return SPORT_COLORS.NEUTRAL;
}

/**
 * Get consistent button classes that respect the design system
 */
export function getButtonClasses(variant: 'primary' | 'secondary' | 'neutral' = 'primary', sportKey?: SportKey) {
  const baseClasses = `min-h-[${LAYOUT.BUTTON.MIN_HEIGHT}] px-4 py-2 text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2`;
  
  if (variant === 'neutral' || !sportKey) {
    return `${baseClasses} bg-gray-600 text-white hover:bg-gray-700 focus:ring-gray-500`;
  }
  
  const colors = getSportColorClasses(sportKey);
  
  switch (variant) {
    case 'primary':
      return `${baseClasses} ${colors.buttonPrimary} focus:ring-${colors.token}-500`;
    case 'secondary':
      return `${baseClasses} border border-gray-300 ${colors.buttonSecondary} bg-white hover:bg-gray-50 focus:ring-${colors.token}-500`;
    default:
      return baseClasses;
  }
}

// Export all tokens for easy importing
export {
  TYPOGRAPHY as typography,
  ICONS as icons,  
  SPACING as spacing,
  LAYOUT as layout,
  CSS_CLASSES as cssClasses
};