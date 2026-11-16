/** 41.202.18.18 → 41.202.•••.18; an IPv6 address keeps its first two groups (as EXPENZO). */
export function maskIp(ip: string | null): string | null {
  if (!ip) return ip;
  const v4 = ip.replace(/^::ffff:/, '');
  const parts = v4.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.•••.${parts[3]}`;
  const groups = ip.split(':').filter(Boolean);
  return groups.length > 2 ? `${groups[0]}:${groups[1]}:•••` : '•••';
}
