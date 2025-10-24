/**
 * Data formatting utilities for athlete profiles
 * Handles conversions, null safety, and consistent display formatting
 */

// Height formatting: cm -> feet/inches display
export const formatHeight = (heightCm: number | null | undefined): string => {
  if (!heightCm || heightCm <= 0) return "—";
  
  const totalInches = heightCm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  
  return `${feet}'${inches}"`;
};

// Weight formatting: kg -> lbs display (legacy)
export const formatWeight = (weightKg: number | null | undefined): string => {
  if (!weightKg || weightKg <= 0) return "—";
  
  const pounds = Math.round(weightKg * 2.20462);
  return `${pounds} lbs`;
};

// Weight formatting with unit preference
export const formatWeightWithUnit = (weightKg: number | null | undefined, unit?: 'lbs' | 'kg' | 'stone' | null): string => {
  if (!weightKg || weightKg <= 0) return "—";
  
  const displayUnit = unit || 'lbs';
  
  switch (displayUnit) {
    case 'kg':
      return `${weightKg.toFixed(1)} kg`;
    case 'stone':
      const totalLbs = weightKg * 2.20462;
      const stones = Math.floor(totalLbs / 14);
      const remainingLbs = Math.round(totalLbs % 14);
      if (remainingLbs > 0) {
        return `${stones} st ${remainingLbs} lbs`;
      }
      return `${stones} st`;
    case 'lbs':
    default:
      const pounds = Math.round(weightKg * 2.20462);
      return `${pounds} lbs`;
  }
};

// Age calculation from date of birth
export const formatAge = (dob: string | null | undefined): string => {
  if (!dob) return "—";
  
  try {
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return "—";
    
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age >= 0 ? `${age}` : "—";
  } catch {
    return "—";
  }
};

// Date formatting: ISO -> human readable
export const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return "—";
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "—";
    
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return "—";
  }
};

// Score/rating formatting: clamp 0-100, null -> "—"
export const formatScore = (score: number | null | undefined): string => {
  if (score === null || score === undefined || isNaN(score)) return "—";
  
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  return clampedScore.toString();
};

// Display name with fallback
// NEW: Now uses first_name + middle_name + last_name for display
// full_name is used as username/handle
export const formatDisplayName = (
  firstName?: string | null,
  middleName?: string | null,
  lastName?: string | null,
  username?: string | null
): string => {
  // Build full name from parts
  const nameParts = [
    firstName?.trim(),
    middleName?.trim(),
    lastName?.trim()
  ].filter(Boolean);

  if (nameParts.length > 0) {
    return nameParts.join(' ');
  }

  // Fallback to username if available
  if (username?.trim()) {
    return username.trim();
  }

  return 'Unknown User';
};

// Legacy function for backwards compatibility with old code
export const formatDisplayNameLegacy = (
  fullName?: string | null,
  firstName?: string | null,
  lastName?: string | null
): string => {
  if (fullName?.trim()) return fullName.trim();
  if (firstName && lastName) return `${firstName.trim()} ${lastName.trim()}`;
  if (firstName) return firstName.trim();
  return 'Unknown User';
};

// Get initials for avatar fallback
export const getInitials = (name?: string | null): string => {
  if (!name?.trim()) return 'UA';
  return name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
};

// Social media handle formatting (remove @ if present)
export const formatSocialHandle = (handle: string | null | undefined): string => {
  if (!handle?.trim()) return "";
  return handle.trim().replace(/^@/, '');
};

// Social media handle formatting for display (shows — for empty)
export const formatSocialHandleDisplay = (handle: string | null | undefined): string => {
  if (!handle?.trim()) return "—";
  return handle.trim().replace(/^@/, '');
};

// Convert height from feet/inches input to cm for storage
export const parseHeightToCm = (feetInchesInput: string): number | undefined => {
  if (!feetInchesInput?.trim()) return undefined;
  
  const input = feetInchesInput.trim().toLowerCase();
  
  // Handle decimal feet (like "5.8" meaning 5'8")
  const decimalMatch = input.match(/^(\d+)\.(\d+)$/);
  if (decimalMatch) {
    const feet = parseInt(decimalMatch[1]);
    const inches = parseInt(decimalMatch[2]);
    if (feet >= 3 && feet <= 8 && inches >= 0 && inches <= 11) {
      const totalInches = (feet * 12) + inches;
      return Math.round(totalInches * 2.54);
    }
  }
  
  // Handle concatenated format (like "510" meaning 5'10")
  const concatenatedMatch = input.match(/^([4-8])([0-9]{1,2})$/);
  if (concatenatedMatch) {
    const feet = parseInt(concatenatedMatch[1]);
    const inches = parseInt(concatenatedMatch[2]);
    if (inches < 12) {
      const totalInches = (feet * 12) + inches;
      return Math.round(totalInches * 2.54);
    }
  }
  
  // Handle various separators (', ", -, :, /, space)
  const separatorMatch = input.match(/(\d+)[\s'":/-]*(\d*)/);
  if (separatorMatch) {
    const feet = parseInt(separatorMatch[1]) || 0;
    const inches = parseInt(separatorMatch[2]) || 0;
    
    // Reasonable height bounds: 3'0" to 8'11"
    if (feet >= 3 && feet <= 8 && inches >= 0 && inches < 12) {
      const totalInches = (feet * 12) + inches;
      return Math.round(totalInches * 2.54);
    }
  }
  
  // Handle just feet (like "6" meaning 6'0")
  const feetOnlyMatch = input.match(/^(\d+)(?:\s*(?:ft|feet|').*)?$/);
  if (feetOnlyMatch) {
    const feet = parseInt(feetOnlyMatch[1]);
    if (feet >= 3 && feet <= 8) {
      const totalInches = feet * 12;
      return Math.round(totalInches * 2.54);
    }
  }
  
  return undefined;
};

// Convert weight from lbs input to kg for storage
export const parseWeightToKg = (lbsInput: string): number | undefined => {
  if (!lbsInput?.trim()) return undefined;
  
  const input = lbsInput.trim().toLowerCase();
  
  // Handle different weight formats
  let pounds: number | undefined;
  
  // Handle kg input (convert to pounds first)
  const kgMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:kg|kilos?|kilogram)/);
  if (kgMatch) {
    const kg = parseFloat(kgMatch[1]);
    if (!isNaN(kg) && kg > 0) {
      pounds = kg * 2.20462; // Convert kg to pounds
    }
  }
  
  // Handle stones (UK) - 1 stone = 14 pounds
  const stoneMatch = input.match(/(\d+(?:\.\d+)?)\s*(?:stone|st)/);
  if (stoneMatch && !pounds) {
    const stones = parseFloat(stoneMatch[1]);
    if (!isNaN(stones) && stones > 0) {
      pounds = stones * 14;
    }
  }
  
  // Handle decimal with comma (European format like "150,5")
  if (!pounds) {
    const commaDecimal = input.replace(',', '.');
    const cleanedComma = commaDecimal.replace(/[^\d.-]/g, '');
    const testPounds = parseFloat(cleanedComma);
    if (!isNaN(testPounds) && testPounds > 0) {
      pounds = testPounds;
    }
  }
  
  // Handle standard pounds input (remove all non-numeric except decimal point)
  if (!pounds) {
    const cleaned = input.replace(/[^\d.-]/g, '');
    const testPounds = parseFloat(cleaned);
    if (!isNaN(testPounds) && testPounds > 0) {
      pounds = Math.abs(testPounds); // Handle negative signs as user error
    }
  }
  
  // Validate reasonable weight bounds (50-500 lbs for athletes)
  if (pounds && pounds >= 50 && pounds <= 500) {
    return Math.round((pounds / 2.20462) * 100) / 100; // Round to 2 decimals for precision
  }
  
  return undefined;
};

// Validation functions that return both parsed value and error message
export interface ValidationResult<T> {
  value: T | undefined;
  error?: string;
}

// Validate and parse height with user-friendly error messages
export const validateHeight = (input: string): ValidationResult<number> => {
  if (!input?.trim()) {
    return { value: undefined };
  }

  const result = parseHeightToCm(input);
  if (result) {
    return { value: result };
  }

  // Provide helpful error message based on input
  const trimmed = input.trim().toLowerCase();
  
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed);
    if (num < 30) {
      return { 
        value: undefined, 
        error: "Please enter height in feet and inches (e.g., '5'10\"' or '5 10')" 
      };
    } else if (num > 100) {
      return { 
        value: undefined, 
        error: "Height seems too tall. Please enter in feet and inches (e.g., '6'2\"')" 
      };
    }
  }

  if (trimmed.includes("cm") || trimmed.includes("meter")) {
    return { 
      value: undefined, 
      error: "Please enter height in feet and inches (e.g., '5'8\"' or '6 feet')" 
    };
  }

  return { 
    value: undefined, 
    error: "Invalid height format. Try: 5'10\", 5 10, or 6 feet" 
  };
};

// Validate and parse weight with user-friendly error messages
export const validateWeight = (input: string): ValidationResult<number> => {
  if (!input?.trim()) {
    return { value: undefined };
  }

  const result = parseWeightToKg(input);
  if (result) {
    return { value: result };
  }

  // Provide helpful error message based on input
  const trimmed = input.trim().toLowerCase();
  
  const numMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    const num = parseFloat(numMatch[1]);
    if (num < 50) {
      return { 
        value: undefined, 
        error: "Weight seems too light for an athlete. Please enter weight in pounds (50-500 lbs)" 
      };
    } else if (num > 500) {
      return { 
        value: undefined, 
        error: "Weight seems too heavy. Please enter a realistic weight (50-500 lbs)" 
      };
    }
  }

  return { 
    value: undefined, 
    error: "Invalid weight format. Try: 150, 150 lbs, 68 kg, or 11 stone" 
  };
};