import { RequestMethod } from '@nestjs/common';

/** Every route of the API is under /api/v1 (as EXPENZO's and the core's). */
export const API_PREFIX = 'api/v1';

/** The root (GET /, the manifest's healthUrl) stays outside the prefix. */
export const API_PREFIX_OPTIONS = {
  exclude: [{ path: '/', method: RequestMethod.GET }],
};
