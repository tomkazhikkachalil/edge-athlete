'use client';

import { useState, useEffect } from 'react';
import { validateHandleFormat, checkHandleAvailability, generateHandleSuggestions } from '@/lib/handle-validation';

interface HandleSelectorProps {
  initialHandle?: string;
  onHandleSelected: (handle: string) => void;
  firstName?: string;
  lastName?: string;
  required?: boolean;
}

export default function HandleSelector({
  initialHandle = '',
  onHandleSelected,
  firstName,
  lastName,
  required = true
}: HandleSelectorProps) {
  const [handle, setHandle] = useState(initialHandle);
  const [validationMessage, setValidationMessage] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Generate initial suggestions based on name
  useEffect(() => {
    if (firstName || lastName) {
      const initialSuggestions = generateHandleSuggestions(firstName, lastName);
      setSuggestions(initialSuggestions);
    }
  }, [firstName, lastName]);

  // Debounced validation and availability check
  useEffect(() => {
    if (!handle) {
      setValidationMessage('');
      setIsValid(false);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      // Format validation
      const formatResult = validateHandleFormat(handle);

      if (!formatResult.isValid) {
        setValidationMessage(formatResult.error || 'Invalid handle format');
        setIsValid(false);
        setShowSuggestions(false);
        return;
      }

      // Availability check
      setIsChecking(true);
      try {
        const availabilityResult = await checkHandleAvailability(handle);

        if (availabilityResult.available) {
          setValidationMessage('✓ Handle is available!');
          setIsValid(true);
          setShowSuggestions(false);
          onHandleSelected(handle);
        } else {
          setValidationMessage(availabilityResult.reason || 'Handle is not available');
          setIsValid(false);
          if (availabilityResult.suggestions && availabilityResult.suggestions.length > 0) {
            setSuggestions(availabilityResult.suggestions);
            setShowSuggestions(true);
          }
        }
      } catch {
        setValidationMessage('Error checking availability');
        setIsValid(false);
      } finally {
        setIsChecking(false);
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]); // Intentionally excluding onHandleSelected to prevent constant re-checks when parent re-renders

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;

    // Remove @ prefix if user types it
    if (value.startsWith('@')) {
      value = value.substring(1);
    }

    // Remove spaces (enforce NO SPACES requirement)
    value = value.replace(/\s/g, '');

    // Convert to lowercase
    value = value.toLowerCase();

    setHandle(value);
  };

  const handleSuggestionClick = (suggestion: string) => {
    setHandle(suggestion);
    setShowSuggestions(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="handle" className="block text-sm font-medium text-gray-700 mb-1">
          Choose Your Handle {required && <span className="text-red-500">*</span>}
        </label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className="text-gray-500 text-lg">@</span>
          </div>
          <input
            type="text"
            id="handle"
            value={handle}
            onChange={handleInputChange}
            placeholder="yourhandle"
            className={`
              block w-full pl-8 pr-10 py-2 border rounded-lg
              focus:outline-none focus:ring-2 transition-colors
              ${isValid
                ? 'border-green-500 focus:ring-green-500'
                : validationMessage && !isChecking
                  ? 'border-red-500 focus:ring-red-500'
                  : 'border-gray-300 focus:ring-blue-500'
              }
            `}
            required={required}
            minLength={3}
            maxLength={20}
            pattern="[a-z0-9][a-z0-9._]*[a-z0-9]"
            autoComplete="off"
          />
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center">
            {isChecking ? (
              <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full"></div>
            ) : isValid ? (
              <i className="fas fa-check-circle text-green-500 text-xl"></i>
            ) : validationMessage ? (
              <i className="fas fa-times-circle text-red-500 text-xl"></i>
            ) : null}
          </div>
        </div>

        {/* Validation message */}
        {validationMessage && (
          <p className={`mt-1 text-sm ${isValid ? 'text-green-600' : 'text-red-600'}`}>
            {validationMessage}
          </p>
        )}

        {/* Format requirements */}
        <p className="mt-1 text-xs text-gray-500">
          3-20 characters • Letters, numbers, dots, underscores • No spaces • Must start and end with letter or number
        </p>
      </div>

      {/* Suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <p className="text-sm font-medium text-gray-700 mb-2">
            Available suggestions:
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => handleSuggestionClick(suggestion)}
                className="px-3 py-1 bg-white border border-gray-300 rounded-full text-sm hover:bg-blue-50 hover:border-blue-500 transition-colors"
              >
                @{suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
