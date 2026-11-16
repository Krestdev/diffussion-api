import type { Type } from '@nestjs/common';
import { defaultMetadataStorage } from 'class-transformer/cjs/storage';
import { getMetadataStorage } from 'class-validator';
import type { ValidationMetadata } from 'class-validator/types/metadata/ValidationMetadata';
import { z } from 'zod';

/** Where class-transformer keeps @Type() targets (its deep import carries no usable types). */
const typeStorage = defaultMetadataStorage as unknown as {
  findTypeMetadata(
    target: object,
    property: string,
  ): { typeFunction: () => unknown } | undefined;
};

/** Where @ApiProperty() / @ApiPropertyOptional() keep a field's options. */
const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';

/**
 * Builds a tool's input schema from a REST DTO's class-validator decorators, so the schema
 * the model sees can't drift from what the API accepts. The DTO still validates every call
 * (see ToolContext.dto): this schema only tells the model what to send.
 *
 * Covered: strings (length, pattern), UUIDs, ISO dates, enums and "in" lists, numbers,
 * booleans, objects, arrays (`each`, sizes) and nested DTOs (@ValidateNested + @Type).
 * Anything else becomes "any JSON value", still checked by the DTO. Field help comes from
 * @ApiProperty({ description }).
 */
export function dtoShape(
  type: Type<object>,
  seen = new Set<Type<object>>(),
): Record<string, z.ZodType> {
  if (seen.has(type)) return {};
  seen.add(type);
  const metas = getMetadataStorage().getTargetValidationMetadatas(
    type,
    '',
    true,
    false,
  );
  const byProperty = new Map<string, ValidationMetadata[]>();
  for (const meta of metas) {
    const list = byProperty.get(meta.propertyName) ?? [];
    list.push(meta);
    byProperty.set(meta.propertyName, list);
  }
  const defaults = instance(type);
  const shape: Record<string, z.ZodType> = {};
  for (const [property, list] of byProperty) {
    let schema = propertySchema(type, property, list, seen);
    const description = describe(type, property);
    if (description) schema = schema.describe(description);
    const optional =
      list.some((m) => m.type === 'conditionalValidation') ||
      (defaults as Record<string, unknown>)[property] !== undefined;
    shape[property] = optional ? schema.optional() : schema;
  }
  seen.delete(type);
  return shape;
}

function propertySchema(
  owner: Type<object>,
  property: string,
  list: ValidationMetadata[],
  seen: Set<Type<object>>,
): z.ZodType {
  const item = list.filter((m) => m.each);
  const self = list.filter((m) => !m.each);
  const isArray = item.length > 0 || self.some((m) => m.name === 'isArray');
  const nested = list.some((m) => m.type === 'nestedValidation');

  let element: z.ZodType;
  if (nested) {
    const nestedType = typeStorage
      .findTypeMetadata(owner, property)
      ?.typeFunction() as Type<object> | undefined;
    element = nestedType
      ? z.object(dtoShape(nestedType, seen)).strict()
      : z.record(z.string(), z.unknown());
  } else {
    element = scalar(isArray ? item : self);
  }
  if (!isArray) return element;

  let array = z.array(element);
  for (const m of self) {
    const [limit] = (m.constraints ?? []) as [number?];
    if (limit === undefined) continue;
    if (m.name === 'arrayMaxSize') array = array.max(limit);
    if (m.name === 'arrayMinSize') array = array.min(limit);
  }
  return array;
}

/** One value: the first type-defining constraint wins, then its bounds. */
function scalar(list: ValidationMetadata[]): z.ZodType {
  const named = (name: string) => list.find((m) => m.name === name);
  const constraints = (name: string) =>
    (named(name)?.constraints ?? []) as unknown[];

  if (named('isUuid')) return z.uuid();
  if (named('isEnum')) return enumOf(constraints('isEnum')[1]);
  if (named('isIn')) return enumOf(constraints('isIn')[0]);
  if (named('isBoolean')) return z.boolean();
  if (named('isIso8601') || named('isDateString')) {
    return z.string().describe('ISO 8601 date or date-time, e.g. 2026-10-06');
  }
  if (named('isEmail')) return z.email();
  if (named('isUrl')) return z.url();
  if (named('isInt') || named('isNumber') || named('isPositive')) {
    let number = named('isInt') ? z.number().int() : z.number();
    if (named('min')) number = number.min(constraints('min')[0] as number);
    if (named('max')) number = number.max(constraints('max')[0] as number);
    if (named('isPositive')) number = number.positive();
    return number;
  }
  if (named('isObject')) return z.record(z.string(), z.unknown());
  if (
    named('isString') ||
    named('matches') ||
    named('maxLength') ||
    named('isTimeZone')
  ) {
    let string = z.string();
    if (named('minLength')) {
      string = string.min(constraints('minLength')[0] as number);
    }
    if (named('maxLength')) {
      string = string.max(constraints('maxLength')[0] as number);
    }
    if (named('isNotEmpty')) string = string.min(1);
    const pattern = constraints('matches')[0];
    if (pattern instanceof RegExp) string = string.regex(pattern);
    return string;
  }
  return z.unknown();
}

function enumOf(values: unknown): z.ZodType {
  const list = Array.isArray(values)
    ? values
    : Object.values((values ?? {}) as Record<string, unknown>);
  const strings = list.filter((v): v is string => typeof v === 'string');
  return strings.length
    ? z.enum(strings as [string, ...string[]])
    : z.unknown();
}

function instance(type: Type<object>): object {
  try {
    return new type();
  } catch {
    return {};
  }
}

/** The field's @ApiProperty description, looked up the class chain. */
function describe(type: Type<object>, property: string): string | undefined {
  for (
    let current: unknown = type;
    typeof current === 'function' && current !== Function.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    const options = Reflect.getMetadata(
      API_MODEL_PROPERTIES,
      (current as Type<object>).prototype as object,
      property,
    ) as { description?: unknown } | undefined;
    if (typeof options?.description === 'string' && options.description) {
      return options.description;
    }
  }
  return undefined;
}
