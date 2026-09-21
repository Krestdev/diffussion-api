import { Transform } from 'class-transformer';

// Emails are stored and compared in lowercase so `Jane@x.com` and
// `jane@x.com` resolve to the same account (the DB unique index on
// user.email is case-sensitive).
export const NormalizeEmail = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
