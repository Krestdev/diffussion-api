// Minimal structural types for the inline request-id middleware above —
// avoids pulling in `any` just to stamp a correlation id on the request.
export type RequestWithId = {
  headers: Record<string, string | string[] | undefined>;
  __requestId?: string;
};
export type ResponseLike = { setHeader: (name: string, value: string) => void };
export type NextFn = () => void;
