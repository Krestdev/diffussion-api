import { Transform } from 'class-transformer';

// Surrounding spaces are dropped before validation, so a text made only of
// spaces counts as empty (@IsNotEmpty refuses it).
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
