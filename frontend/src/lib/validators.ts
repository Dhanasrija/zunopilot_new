// Centralised form validation helpers. Each `validate*` returns either
// an error message string OR null if the value is valid.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const URL_RE   = /^https?:\/\/[^\s$.?#].[^\s]*$/i;
const NAME_RE  = /^[a-zA-Z\s.'-]+$/; // letters, spaces, apostrophes, dots, hyphens

export function validateRequired(value: string | undefined | null, fieldName = 'Field'): string | null {
  return !value || !value.trim() ? `${fieldName} is required` : null;
}

export function validateEmail(value: string): string | null {
  if (!value.trim()) return 'Email is required';
  if (value.length > 100) return 'Email must be 100 characters or fewer';
  if (!EMAIL_RE.test(value.trim())) return 'Enter a valid email address';
  return null;
}

export function validatePassword(value: string, min = 8): string | null {
  if (!value) return 'Password is required';
  if (value.length < min) return `Password must be at least ${min} characters`;
  if (value.length > 64) return 'Password must be 64 characters or fewer';
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return 'Password must include at least one letter and one number';
  }
  return null;
}

export function validateName(value: string, fieldName = 'Name'): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${fieldName} is required`;
  if (trimmed.length < 2) return `${fieldName} must be at least 2 characters`;
  if (trimmed.length > 60) return `${fieldName} must be 60 characters or fewer`;
  if (!NAME_RE.test(trimmed)) return `${fieldName} can only contain letters and spaces`;
  return null;
}

export function validatePhone(value: string, min = 7, max = 15): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return 'Phone number is required';
  if (digits.length < min || digits.length > max) {
    return `Phone number must be between ${min} and ${max} digits`;
  }
  return null;
}

export function validateUrl(value: string, required = false): string | null {
  if (!value || !value.trim()) return required ? 'Website is required' : null;
  if (value.length > 200) return 'URL must be 200 characters or fewer';
  if (!URL_RE.test(value.trim())) return 'Enter a valid URL starting with http:// or https://';
  return null;
}

export function validateMaxLength(value: string, max: number, fieldName = 'Field'): string | null {
  if (value.length > max) return `${fieldName} must be ${max} characters or fewer`;
  return null;
}

/* ---------- Input-coercion helpers (use in onChange) ---------- */

/** Strip everything that isn't a digit, then optionally enforce a max length. */
export function digitsOnly(value: string, maxLen?: number): string {
  const digits = value.replace(/\D/g, '');
  return maxLen ? digits.slice(0, maxLen) : digits;
}

/** Strip everything that isn't a letter, space, apostrophe, dot, or hyphen. */
export function lettersOnly(value: string, maxLen?: number): string {
  const filtered = value.replace(/[^a-zA-Z\s.'-]/g, '');
  return maxLen ? filtered.slice(0, maxLen) : filtered;
}
