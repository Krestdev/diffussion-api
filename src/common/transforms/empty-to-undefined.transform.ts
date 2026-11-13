import { Transform } from 'class-transformer';

/**
 * Treats an empty string as "not provided".
 *
 * Multipart forms — Swagger's file upload form in particular — send every
 * optional field, empty ones included, as `""`. Without this, `@IsOptional()`
 * sees a defined value and the field's own rule (`@IsUUID()`, ...) rejects it.
 */
export const EmptyToUndefined = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );
