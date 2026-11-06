import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { Agent, request } from 'undici';
import type { FetchResult, Fetcher } from '@revenant/engine';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 10_000; // 10 s
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SSRFFetcherOptions {
  /** Maximum response body size in bytes. Default 5 MB. */
  maxBytes?: number;
  /** Overall timeout (all hops and body streaming) in milliseconds. Default 10 s. */
  timeoutMs?: number;
  /** Maximum number of redirect hops to follow. Default 5. */
  maxRedirects?: number;
}

/**
 * Fetcher that refuses to reach private, loopback, link-local and other
 * non-public addresses. Every resolved address is validated and the validated
 * addresses are pinned for the connection, so a second DNS answer cannot
 * redirect the socket to an internal host (DNS rebinding).
 */
export class SSRFFetcher implements Fetcher {
  private readonly blocklist = new net.BlockList();
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;

  constructor(options: SSRFFetcherOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    const b = this.blocklist;
    // RFC 1918 private ranges
    b.addSubnet('10.0.0.0', 8, 'ipv4');
    b.addSubnet('172.16.0.0', 12, 'ipv4');
    b.addSubnet('192.168.0.0', 16, 'ipv4');
    // Loopback
    b.addSubnet('127.0.0.0', 8, 'ipv4');
    b.addAddress('::1', 'ipv6');
    // Link-local, including the cloud metadata endpoint
    b.addSubnet('169.254.0.0', 16, 'ipv4');
    b.addAddress('169.254.169.254', 'ipv4');
    b.addSubnet('fe80::', 10, 'ipv6');
    // Carrier-grade NAT
    b.addSubnet('100.64.0.0', 10, 'ipv4');
    // "This network" and the IPv6 unspecified address (both reach localhost on Linux)
    b.addSubnet('0.0.0.0', 8, 'ipv4');
    b.addAddress('::', 'ipv6');
    // IPv6 unique-local
    b.addSubnet('fc00::', 7, 'ipv6');
    // Multicast
    b.addSubnet('224.0.0.0', 4, 'ipv4');
    b.addSubnet('ff00::', 8, 'ipv6');
    // Reserved / documentation / benchmarking IPv4 ranges
    b.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
    b.addSubnet('192.0.2.0', 24, 'ipv4'); // TEST-NET-1
    b.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
    b.addSubnet('198.51.100.0', 24, 'ipv4'); // TEST-NET-2
    b.addSubnet('203.0.113.0', 24, 'ipv4'); // TEST-NET-3
    b.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved (future use)
    b.addAddress('255.255.255.255', 'ipv4'); // limited broadcast (also inside 240.0.0.0/4)
    // IPv6 transition mechanisms that embed an IPv4 address. A public feed fetcher
    // never needs them, and they can reach internal IPv4 hosts (e.g. 64:ff9b::7f00:1
    // via a NAT64 gateway), so they are blocked outright rather than unwrapped.
    // IPv4-mapped ::ffff:0:0/96 is deliberately NOT listed: BlockList matches those
    // against the IPv4 rules above, so public mapped addresses stay reachable.
    b.addSubnet('::', 96, 'ipv6'); // IPv4-compatible (deprecated), ::a.b.c.d
    b.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64 well-known prefix (RFC 6052)
    b.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64 (RFC 8215)
    b.addSubnet('2002::', 16, 'ipv6'); // 6to4 (RFC 3056)
    b.addSubnet('2001::', 32, 'ipv6'); // Teredo (RFC 4380)
  }

  async fetch(url: string): Promise<FetchResult> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      return await this.fetchFollowingRedirects(url, signal);
    } catch (err) {
      if (signal.aborted) {
        throw new Error('Request timeout', { cause: err });
      }
      throw err;
    }
  }

  private async fetchFollowingRedirects(url: string, signal: AbortSignal): Promise<FetchResult> {
    let current = this.parseUrl(url);

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      const ips = await this.resolveAndValidate(current.hostname);
      const response = await this.requestPinned(current, ips, signal);

      const location = response.headers['location'];
      if (!REDIRECT_STATUSES.has(response.status) || location === undefined) {
        return response.result;
      }
      current = this.parseUrl(new URL(location, current).toString());
    }
    throw new Error('Too many redirects');
  }

  /** Validates scheme and strips credentials. */
  private parseUrl(raw: string): URL {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Unsupported scheme: ${parsed.protocol}`);
    }
    parsed.username = '';
    parsed.password = '';
    return parsed;
  }

  private async resolveAndValidate(hostname: string): Promise<string[]> {
    // URL.hostname wraps IPv6 literals in brackets.
    const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;

    if (net.isIP(host) !== 0) {
      this.validateIp(host);
      return [host];
    }

    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0) {
      throw new Error('DNS resolution failed');
    }
    // Validate every address, not just the first.
    for (const { address } of addresses) {
      this.validateIp(address);
    }
    return addresses.map((a) => a.address);
  }

  private validateIp(ip: string): void {
    // BlockList.check defaults to ipv4, so the family must be passed for IPv6.
    // For ipv6 it also matches IPv4-mapped addresses (::ffff:a.b.c.d) against IPv4 rules.
    const family = net.isIPv6(ip) ? 'ipv6' : 'ipv4';
    if (this.blocklist.check(ip, family)) {
      throw new Error('SSRF attempt detected: address is in a blocked range');
    }
  }

  private async requestPinned(
    target: URL,
    ips: string[],
    signal: AbortSignal,
  ): Promise<{ status: number; headers: Record<string, string>; result: FetchResult }> {
    const pinned = ips.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 }));
    // The connect-time lookup returns only the already validated addresses.
    const agent = new Agent({
      connect: {
        lookup: (_hostname, options, callback) => {
          if (options.all) {
            callback(null, pinned);
            return;
          }
          const first = pinned[0];
          if (first === undefined) {
            callback(new Error('No pinned address'), '', 4);
            return;
          }
          callback(null, first.address, first.family);
        },
      },
    });

    try {
      const {
        statusCode,
        headers: rawHeaders,
        body,
      } = await request(target.toString(), {
        method: 'GET',
        dispatcher: agent,
        signal,
      });

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        if (value !== undefined) {
          headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      }

      if (REDIRECT_STATUSES.has(statusCode) && headers['location'] !== undefined) {
        body.destroy();
        return { status: statusCode, headers, result: { body: '', status: statusCode, headers } };
      }

      const declared = Number(headers['content-length']);
      if (Number.isFinite(declared) && declared > this.maxBytes) {
        body.destroy();
        throw new Error('Response too large');
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        size += buf.length;
        if (size > this.maxBytes) {
          body.destroy();
          throw new Error('Response too large');
        }
        chunks.push(buf);
      }

      return {
        status: statusCode,
        headers,
        result: { body: Buffer.concat(chunks).toString('utf-8'), status: statusCode, headers },
      };
    } finally {
      await agent.destroy();
    }
  }
}
