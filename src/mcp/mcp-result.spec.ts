import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { PaginationQueryDto } from '../common/dto/pagination.query.dto';
import { dtoShape } from './dto-schema';
import { EFFET_LINK } from './links';
import { errorBody, shape } from './mcp-result';

describe('shape', () => {
  it('turns a Diffusion page into { total, page, returned, items } with links', () => {
    const page = {
      data: [
        { id: 'a', direction: 'ENTRANT', subject: 'Hello', note: null },
        { id: 'b', direction: 'SORTANT', tags: [] },
      ],
      total: 12,
      skip: 10,
      take: 5,
      metrics: { late: 2 },
    };
    expect(shape(page, EFFET_LINK)).toEqual({
      total: 12,
      page: 3,
      returned: 2,
      items: [
        {
          id: 'a',
          direction: 'ENTRANT',
          subject: 'Hello',
          link: '/dashboard/incoming/a',
        },
        { id: 'b', direction: 'SORTANT', link: '/dashboard/outgoing/b' },
      ],
      metrics: { late: 2 },
    });
  });

  it('turns `actions` into available / unavailable (with the reason) on a record', () => {
    const record = {
      id: 'd1',
      createdAt: new Date('2026-11-16T08:00:00.000Z'),
      actions: [
        { action: 'edit', enabled: true },
        {
          action: 'close',
          enabled: false,
          reason: 'INSTRUCTIONS_OPEN',
          params: { count: '2' },
        },
      ],
      livrables: [
        {
          id: 'l1',
          actions: [{ action: 'submit', enabled: false, reason: 'OWN_ITEM' }],
        },
      ],
    };
    expect(shape(record, '/dashboard/dossiers/{id}')).toEqual({
      id: 'd1',
      createdAt: '2026-11-16T08:00:00.000Z',
      available: ['edit'],
      unavailable: [
        {
          action: 'close',
          reason: 'INSTRUCTIONS_OPEN',
          params: { count: '2' },
        },
      ],
      livrables: [
        {
          id: 'l1',
          unavailable: [{ action: 'submit', reason: 'OWN_ITEM' }],
        },
      ],
      link: '/dashboard/dossiers/d1',
    });
  });

  it('keeps only `available` on list rows', () => {
    expect(
      shape([
        {
          id: 'x',
          actions: [
            { action: 'a', enabled: true },
            { action: 'b', enabled: false, reason: 'WRONG_STATUS' },
          ],
        },
      ]),
    ).toEqual([{ id: 'x', available: ['a'] }]);
  });
});

describe('errorBody', () => {
  it("reads the exception's own code and params", () => {
    expect(
      errorBody(
        new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Missing permission: incoming.read',
          params: { permission: 'incoming.read' },
        }),
      ),
    ).toEqual({
      statusCode: 403,
      code: 'FORBIDDEN',
      params: { permission: 'incoming.read' },
      message: 'Missing permission: incoming.read',
    });
  });

  it('derives a code from the status otherwise, and hides server errors', () => {
    expect(errorBody(new NotFoundException('Courrier x not found')).code).toBe(
      'NOT_FOUND',
    );
    expect(errorBody(new BadRequestException(['a must be a string']))).toEqual(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(errorBody(new BadRequestException('Only drafts')).code).toBe(
      'INVALID_REQUEST',
    );
    expect(errorBody(new Error('boom'))).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('dtoShape', () => {
  it("derives the tool input from the DTO's validators and @ApiProperty help", () => {
    const input = dtoShape(PaginationQueryDto);
    expect(Object.keys(input)).toEqual(['search', 'skip', 'take']);
    const json = z.toJSONSchema(z.object(input)) as {
      properties: Record<string, { description?: string }>;
      required?: string[];
    };
    expect(json.properties.search.description).toBe('Free-text search');
    expect(json.required ?? []).toEqual([]);
    expect(input.take.safeParse(undefined).success).toBe(true);
    expect(input.take.safeParse(501).success).toBe(false);
    expect(input.skip.safeParse(-1).success).toBe(false);
    expect(input.search.safeParse('abc').success).toBe(true);
  });
});
