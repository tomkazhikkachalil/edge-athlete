/**
 * Handle Validation Utilities
 *
 * Validates @handle format and provides user-friendly feedback
 */

export interface HandleValidationResult {
  isValid: boolean;
  error?: string;
  suggestions?: string[];
}

// Reserved words that cannot be used as handles
const RESERVED_HANDLES = new Set([
  // System/Admin
  'admin', 'administrator', 'support', 'help', 'api', 'team', 'staff', 'official', 'verified',
  // Special paths
  'me', 'u', 'user', 'users', 'athlete', 'athletes', 'club', 'clubs', 'league', 'leagues',
  'app', 'dashboard', 'settings', 'profile', 'account',
  // HTTP/Code words
  'null', 'undefined', 'true', 'false', 'root', 'system',
  // Sports
  'golf', 'basketball', 'football', 'soccer', 'baseball', 'hockey', 'volleyball', 'tennis',
  'swimming', 'trackandfield',
  // Brand protection
  'edgeathletes', 'edgeathlete', 'edge'
]);

/**
 * Validate handle format (client-side check)
 */
export function validateHandleFormat(handle: string): HandleValidationResult {
  // Remove @ if present
  const cleanHandle = handle.trim().toLowerCase().replace(/^@/, '');

  // Check length
  if (cleanHandle.length < 3) {
    return {
      isValid: false,
      error: 'Handle must be at least 3 characters long'
    };
  }

  if (cleanHandle.length > 20) {
    return {
      isValid: false,
      error: 'Handle must be 20 characters or less'
    };
  }

  // Check format: letters, numbers, dots, underscores
  // Must start and end with letter or number
  const formatRegex = /^[a-z0-9][a-z0-9._]*[a-z0-9]$/;
  if (!formatRegex.test(cleanHandle)) {
    return {
      isValid: false,
      error: 'Handle can only contain letters, numbers, dots, and underscores. Must start and end with a letter or number.'
    };
  }

  // No consecutive dots or underscores
  if (/[._]{2,}/.test(cleanHandle)) {
    return {
      isValid: false,
      error: 'Handle cannot have consecutive dots or underscores'
    };
  }

  // Check if reserved
  if (RESERVED_HANDLES.has(cleanHandle)) {
    return {
      isValid: false,
      error: 'This handle is reserved by the system',
      suggestions: [
        `${cleanHandle}1`,
        `${cleanHandle}_`,
        `${cleanHandle}2`
      ]
    };
  }

  return {
    isValid: true
  };
}

/**
 * Generate handle suggestions based on name
 */
export function generateHandleSuggestions(
  firstName?: string,
  lastName?: string,
  email?: string
): string[] {
  const suggestions: string[] = [];

  if (firstName && lastName) {
    const firstLast = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    const firstInitialLast = `${firstName[0]}${lastName}`.toLowerCase().replace(/[^a-z0-9]/g, '');
    const lastFirst = `${lastName}${firstName}`.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (firstLast.length >= 3) suggestions.push(firstLast.substring(0, 20));
    if (firstInitialLast.length >= 3) suggestions.push(firstInitialLast.substring(0, 20));
    if (lastFirst.length >= 3) suggestions.push(lastFirst.substring(0, 20));
  } else if (firstName) {
    const first = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (first.length >= 3) {
      suggestions.push(first.substring(0, 20));
      suggestions.push(`${first}${Math.floor(Math.random() * 99) + 1}`.substring(0, 20));
    }
  }

  if (email) {
    const emailHandle = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (emailHandle.length >= 3 && !suggestions.includes(emailHandle)) {
      suggestions.push(emailHandle.substring(0, 20));
    }
  }

  // Add random suggestions if we don't have enough
  if (suggestions.length < 3) {
    const randomSuffix = Math.floor(Math.random() * 9999) + 1;
    suggestions.push(`user${randomSuffix}`);
    suggestions.push(`athlete${randomSuffix}`);
  }

  return suggestions.slice(0, 5);
}

/**
 * Format handle for display (with @ prefix)
 */
export function formatHandle(handle: string | null | undefined): string {
  if (!handle) return '';
  const clean = handle.trim().replace(/^@/, '');
  return `@${clean}`;
}

/**
 * Clean handle input (remove @, trim, lowercase)
 */
export function cleanHandleInput(input: string): string {
  return input.trim().toLowerCase().replace(/^@/, '');
}

/**
 * Check if handle is available (API call)
 */
export async function checkHandleAvailability(
  handle: string,
  currentUserId?: string
): Promise<{
  available: boolean;
  reason?: string;
  suggestions?: string[];
}> {
  try {
    const cleanHandle = cleanHandleInput(handle);

    const params = new URLSearchParams({ handle: cleanHandle });
    if (currentUserId) {
      params.append('currentUserId', currentUserId);
    }

    const response = await fetch(`/api/handles/check?${params.toString()}`);

    if (!response.ok) {
      throw new Error('Failed to check handle availability');
    }

    return await response.json();
  } catch (error) {
    console.error('Error checking handle availability:', error);
    return {
      available: false,
      reason: 'Unable to check availability. Please try again.'
    };
  }
}

/**
 * Update user's handle (API call)
 */
export async function updateHandle(newHandle: string): Promise<{
  success: boolean;
  message: string;
  handle?: string;
}> {
  try {
    const cleanHandle = cleanHandleInput(newHandle);

    const response = await fetch('/api/handles/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: cleanHandle })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        message: data.error || 'Failed to update handle'
      };
    }

    return data;
  } catch (error) {
    console.error('Error updating handle:', error);
    return {
      success: false,
      message: 'Unable to update handle. Please try again.'
    };
  }
}

/**
 * Search for users by handle (for @mentions)
 */
export async function searchHandles(
  query: string,
  limit = 10
): Promise<Array<{
  id: string;
  handle: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  sport: string | null;
  school: string | null;
}>> {
  try {
    const cleanQuery = cleanHandleInput(query);

    if (cleanQuery.length < 1) {
      return [];
    }

    const response = await fetch(
      `/api/handles/search?q=${encodeURIComponent(cleanQuery)}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error('Failed to search handles');
    }

    return await response.json();
  } catch (error) {
    console.error('Error searching handles:', error);
    return [];
  }
}

/**
 * Debounce function for handle input
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
