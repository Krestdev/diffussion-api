// Frontend origins allowed to call the API — shared by the HTTP CORS config
// (main.ts) and the socket.io gateway, so both accept the same frontends.
//
// CORS_ORIGINS in .env:
// - "*" (or unset): any origin is accepted — the request's own Origin is
//   echoed back, so no IP/port ever has to be listed (dev / LAN testing).
// - a comma-separated list: only those origins, e.g. in production
//   "https://diffusion.example.com". An origin is the address of the *page*
//   making the call, never the API's own address.
export function corsOrigins(): string[] | true {
  const configured = (process.env.CORS_ORIGINS ?? '*').trim();
  if (configured === '*') return true;
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
