if (typeof window !== "undefined") {
  throw new Error(
    "server/utils/field-validator.ts must not be imported in client-side code.",
  );
}

type ValidatorFn = (value: unknown) => string[];

/**
 * Entity+field-specific validators override the generic field validator.
 * Key format: "entity.field" e.g. "user.password"
 */
const entityFieldValidators: Record<string, ValidatorFn> = {};

/**
 * Generic field validators applied when no entity-specific override exists.
 * Key format: field name e.g. "email"
 */
const fieldValidators: Record<string, ValidatorFn> = {
  email: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push("validation.email.required");
      return errors;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push("validation.email.invalid");
    }
    return errors;
  },

  phone: (value: unknown): string[] => {
    const errors: string[] = [];
    if (value === undefined || value === null || value === "") return errors;
    if (typeof value !== "string") {
      errors.push("validation.phone.invalid");
      return errors;
    }
    const digits = value.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      errors.push("validation.phone.invalid");
    }
    return errors;
  },

  password: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || value.length === 0) {
      errors.push("validation.password.required");
      return errors;
    }
    if (value.length < 8) {
      errors.push("validation.password.tooShort");
    }
    return errors;
  },

  name: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push("validation.name.required");
    }
    return errors;
  },

  slug: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || value.length === 0) {
      errors.push("validation.slug.required");
      return errors;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
      errors.push("validation.slug.invalid");
    }
    return errors;
  },

  url: (value: unknown): string[] => {
    const errors: string[] = [];
    if (value === undefined || value === null || value === "") return errors;
    if (typeof value !== "string") {
      errors.push("validation.url.invalid");
      return errors;
    }
    try {
      new URL(value);
    } catch {
      errors.push("validation.url.invalid");
    }
    return errors;
  },

  currencyCode: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
      errors.push("validation.currencyCode.invalid");
    }
    return errors;
  },

  cnpj: (value: unknown): string[] => {
    const errors: string[] = [];
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push("validation.cnpj.required");
      return errors;
    }
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 14) {
      errors.push("validation.cnpj.invalid");
      return errors;
    }
    if (/^(\d)\1+$/.test(digits)) {
      errors.push("validation.cnpj.invalid");
      return errors;
    }
    const calcDigit = (base: string, weights: number[]): number => {
      const sum = weights.reduce((acc, w, i) => acc + Number(base[i]) * w, 0);
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const d1 = calcDigit(digits, w1);
    const d2 = calcDigit(digits, w2);
    if (Number(digits[12]) !== d1 || Number(digits[13]) !== d2) {
      errors.push("validation.cnpj.invalid");
    }
    return errors;
  },
};

/**
 * Validates a field value based on the entity and field name.
 *
 * Resolution order:
 * 1. Entity+field specific validator (e.g. "user.email") — if present, overrides generic
 * 2. Generic field validator (e.g. "email")
 * 3. No validator found — returns empty array (valid)
 *
 * @param field - The field name (e.g. "email", "phone", "password")
 * @param value - The value to validate
 * @param entity - Optional entity name (e.g. "user", "lead"). If provided and a
 *   specific validator exists for the entity+field combination, it overrides the
 *   generic field validator.
 * @returns An empty array if valid, or an array of i18n error keys if invalid
 */
export function validateField(
  field: string,
  value: unknown,
  entity?: string,
): string[] {
  if (entity) {
    const entityKey = `${entity}.${field}`;
    if (entityFieldValidators[entityKey]) {
      return entityFieldValidators[entityKey](value);
    }
  }

  if (fieldValidators[field]) {
    return fieldValidators[field](value);
  }

  return [];
}

/**
 * Validates multiple fields at once. Returns a map of field name to error keys.
 * Only fields with errors are included in the result.
 */
export function validateFields(
  fields: { field: string; value: unknown }[],
  entity?: string,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const { field, value } of fields) {
    const fieldErrors = validateField(field, value, entity);
    if (fieldErrors.length > 0) {
      errors[field] = fieldErrors;
    }
  }
  return errors;
}

/**
 * Registers a custom validator for a specific entity+field combination or a
 * generic field validator.
 */
export function registerValidator(
  field: string,
  fn: ValidatorFn,
  entity?: string,
): void {
  if (entity) {
    entityFieldValidators[`${entity}.${field}`] = fn;
  } else {
    fieldValidators[field] = fn;
  }
}
