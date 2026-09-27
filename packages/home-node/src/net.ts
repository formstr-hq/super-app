import { networkInterfaces } from "node:os";

/**
 * Find this machine's Yggdrasil address, if any. Yggdrasil assigns IPv6
 * addresses in `0200::/7` — i.e. the first hextet is in [0x0200, 0x03ff],
 * which is distinct from global unicast (2000::/3, first hextet >= 0x2000) and
 * link-local (fe80::). Returns the first match, or null.
 */
export function detectYggdrasilAddress(): string | null {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      const isV6 = a.family === "IPv6" || (a.family as unknown as number) === 6;
      if (!isV6) continue;
      const addr = a.address.split("%")[0]; // strip zone id
      const firstHextet = parseInt(addr.split(":")[0] || "0", 16);
      if (firstHextet >= 0x0200 && firstHextet <= 0x03ff) return addr;
    }
  }
  return null;
}

export interface ResolvedHosts {
  /** Addresses the admin server should bind to. */
  hosts: string[];
  /** The Yggdrasil address, if one is being bound. */
  ygg: string | null;
}

/**
 * Turn the configured `admin.host` into concrete bind addresses.
 * - "yggdrasil" / "ygg": localhost + the detected Yggdrasil address (mesh-reachable).
 * - "all" / "::": every interface.
 * - anything else: that literal address.
 */
export function resolveAdminHosts(host: string): ResolvedHosts {
  if (host === "yggdrasil" || host === "ygg") {
    const ygg = detectYggdrasilAddress();
    return { hosts: ygg ? ["127.0.0.1", ygg] : ["127.0.0.1"], ygg };
  }
  if (host === "all" || host === "::") {
    return { hosts: ["::"], ygg: detectYggdrasilAddress() };
  }
  return { hosts: [host], ygg: null };
}

/** Format an address + port as a browser URL (bracketing IPv6). */
export function toUrl(host: string, port: number): string {
  const h = host.includes(":") ? `[${host}]` : host;
  return `http://${h}:${port}`;
}
