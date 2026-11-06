import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock, requestMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requestMock: vi.fn(),
}));

vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, request: requestMock };
});

import { SSRFFetcher } from './fetcher.js';

const PUBLIC_IP = '93.184.216.34';

function respond(
  statusCode: number,
  body: string | Buffer | Readable = '',
  headers: Record<string, string> = {},
) {
  const stream = body instanceof Readable ? body : Readable.from([Buffer.from(body)]);
  return { statusCode, headers, body: stream };
}

function dnsReturns(...addresses: string[]) {
  lookupMock.mockResolvedValue(
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}

describe('SSRFFetcher', () => {
  beforeEach(() => {
    lookupMock.mockReset();
    requestMock.mockReset();
  });

  it('fetches from a public IP and returns body, status and headers', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(200, 'hello', { 'Content-Type': 'text/plain' }));

    const result = await new SSRFFetcher().fetch('https://example.com/feed.xml');

    expect(result).toEqual({
      body: 'hello',
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true, verbatim: true });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  // Property 17: SSRF blocks private IPs
  it.each(['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '127.0.0.1', '127.1.2.3'])(
    'blocks hostname resolving to private/loopback IPv4 %s',
    async (ip) => {
      dnsReturns(ip);
      await expect(new SSRFFetcher().fetch('http://internal.example/')).rejects.toThrow(
        'SSRF attempt detected',
      );
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    '100.64.0.1',
    '0.0.0.0',
    '0.1.2.3',
    '169.254.1.1',
    '224.0.0.1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::',
  ])('blocks other reserved address %s', async (ip) => {
    dnsReturns(ip);
    await expect(new SSRFFetcher().fetch('http://reserved.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
  });

  it('blocks when only one of several resolved addresses is private', async () => {
    dnsReturns(PUBLIC_IP, '10.0.0.5');
    await expect(new SSRFFetcher().fetch('http://mixed.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('blocks IP literals in the URL without a DNS lookup', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://[::1]/',
      'http://2130706433/',
      'http://[::ffff:7f00:1]/',
    ]) {
      await expect(new SSRFFetcher().fetch(url)).rejects.toThrow('SSRF attempt detected');
    }
    expect(lookupMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  // Property 18: blocks metadata endpoint
  it('blocks the cloud metadata endpoint', async () => {
    dnsReturns('169.254.169.254');
    await expect(new SSRFFetcher().fetch('http://metadata.example/latest')).rejects.toThrow(
      'SSRF attempt detected',
    );
    await expect(new SSRFFetcher().fetch('http://169.254.169.254/latest')).rejects.toThrow(
      'SSRF attempt detected',
    );
  });

  it('blocks IPv6 loopback', async () => {
    dnsReturns('::1');
    await expect(new SSRFFetcher().fetch('http://v6.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
  });

  // Property 19: blocks IPv4-mapped private IPv6
  it.each(['::ffff:192.168.1.1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe'])(
    'blocks IPv4-mapped IPv6 address %s',
    async (ip) => {
      dnsReturns(ip);
      await expect(new SSRFFetcher().fetch('http://mapped.example/')).rejects.toThrow(
        'SSRF attempt detected',
      );
    },
  );

  // Regression: ::ffff:0:0/96 is not in the IPv6 blocklist; BlockList matches mapped
  // addresses against the IPv4 rules, in both dotted and hex notation.
  it.each([
    ['::ffff:127.0.0.1', 'loopback, dotted'],
    ['::ffff:7f00:1', 'loopback, hex'],
    ['::ffff:c0a8:101', 'RFC 1918, hex'],
    ['::ffff:a9fe:a9fe', 'metadata, hex'],
    ['::ffff:192.0.2.1', 'newly blocked reserved range'],
    ['::ffff:240.0.0.1', 'newly blocked reserved range'],
  ])('regression: blocks IPv4-mapped %s (%s) without connecting', async (ip) => {
    dnsReturns(ip);
    await expect(new SSRFFetcher().fetch('http://mapped.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    ['192.0.0.1', '192.0.0.0/24'],
    ['192.0.0.255', '192.0.0.0/24'],
    ['192.0.2.1', '192.0.2.0/24'],
    ['198.18.0.1', '198.18.0.0/15'],
    ['198.19.255.254', '198.18.0.0/15'],
    ['198.51.100.7', '198.51.100.0/24'],
    ['203.0.113.9', '203.0.113.0/24'],
    ['240.0.0.1', '240.0.0.0/4'],
    ['250.1.2.3', '240.0.0.0/4'],
    ['255.255.255.255', 'broadcast'],
  ])('blocks reserved IPv4 %s (%s) before connecting', async (ip) => {
    dnsReturns(ip);
    await expect(new SSRFFetcher().fetch('http://reserved.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each([
    ['::127.0.0.1', 'IPv4-compatible, dotted'],
    ['::7f00:1', 'IPv4-compatible, hex'],
    ['::a00:1', 'IPv4-compatible, 10.0.0.1'],
    ['::808:808', 'IPv4-compatible, public IPv4'],
    ['64:ff9b::7f00:1', 'NAT64 -> 127.0.0.1'],
    ['64:ff9b::808:808', 'NAT64 -> public IPv4'],
    ['64:ff9b:1::7f00:1', 'local-use NAT64'],
    ['64:ff9b:1:ffff::1', 'local-use NAT64, end of /48'],
    ['2002:7f00:1::', '6to4 -> 127.0.0.1'],
    ['2002:808:808::1', '6to4 -> public IPv4'],
    ['2001::1', 'Teredo'],
    ['2001:0:4136:e378:8000:63bf:3fff:fdd2', 'Teredo, full form'],
  ])('blocks IPv6 transition address %s (%s) before connecting', async (ip) => {
    dnsReturns(ip);
    await expect(new SSRFFetcher().fetch('http://transition.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it.each(['http://[::127.0.0.1]/', 'http://[64:ff9b::7f00:1]/', 'http://[2002:7f00:1::]/'])(
    'blocks IPv6 transition literal %s without a DNS lookup or connection',
    async (url) => {
      await expect(new SSRFFetcher().fetch(url)).rejects.toThrow('SSRF attempt detected');
      expect(lookupMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    },
  );

  it('blocks a redirect to a NAT64 address before connecting to it', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValueOnce(respond(302, '', { location: 'http://[64:ff9b::7f00:1]/' }));
    await expect(new SSRFFetcher().fetch('http://good.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e'])(
    'still allows public IPv6 address %s',
    async (ip) => {
      dnsReturns(ip);
      requestMock.mockResolvedValue(respond(200, 'ok'));
      await expect(new SSRFFetcher().fetch('http://v6-public.example/')).resolves.toMatchObject({
        status: 200,
      });
    },
  );

  it('allows an IPv4-mapped IPv6 address that maps to a public IPv4', async () => {
    dnsReturns('::ffff:5db8:d822'); // 93.184.216.34
    requestMock.mockResolvedValue(respond(200, 'ok'));
    await expect(new SSRFFetcher().fetch('http://mapped-public.example/')).resolves.toMatchObject({
      status: 200,
    });
  });

  it('does not put internal addresses in the error message', async () => {
    dnsReturns('10.9.8.7');
    const err = await new SSRFFetcher().fetch('http://x.example/').catch((e: Error) => e);
    expect((err as Error).message).not.toContain('10.9.8.7');
  });

  it.each(['ftp://example.com/file', 'file:///etc/passwd', 'gopher://example.com/'])(
    'rejects unsupported scheme in %s',
    async (url) => {
      await expect(new SSRFFetcher().fetch(url)).rejects.toThrow('Unsupported scheme');
      expect(lookupMock).not.toHaveBeenCalled();
    },
  );

  it('strips credentials from the URL before resolving and connecting', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(200, 'ok'));

    await new SSRFFetcher().fetch('https://user:secret@example.com/path?q=1');

    expect(lookupMock).toHaveBeenCalledWith('example.com', expect.anything());
    const requestedUrl = requestMock.mock.calls[0]?.[0] as string;
    expect(requestedUrl).toBe('https://example.com/path?q=1');
    expect(requestedUrl).not.toContain('secret');
  });

  it('pins the validated IP for the connection via a custom dispatcher', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(200, 'ok'));

    await new SSRFFetcher().fetch('https://example.com/');

    const options = requestMock.mock.calls[0]?.[1] as { dispatcher: unknown };
    expect(options.dispatcher).toBeDefined();
  });

  it('wraps a DNS failure as an error', async () => {
    lookupMock.mockResolvedValue([]);
    await expect(new SSRFFetcher().fetch('http://nowhere.example/')).rejects.toThrow(
      'DNS resolution failed',
    );
  });

  // Property 20: DNS rebinding mitigation
  it('blocks a redirect whose target resolves to a private IP', async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host === 'evil.example'
        ? [{ address: '192.168.0.10', family: 4 }]
        : [{ address: PUBLIC_IP, family: 4 }],
    );
    requestMock.mockResolvedValueOnce(respond(302, '', { location: 'http://evil.example/admin' }));

    await expect(new SSRFFetcher().fetch('http://good.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to a private IP literal', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValueOnce(respond(301, '', { location: 'http://169.254.169.254/' }));

    await expect(new SSRFFetcher().fetch('http://good.example/')).rejects.toThrow(
      'SSRF attempt detected',
    );
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a redirect to an unsupported scheme', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValueOnce(respond(302, '', { location: 'file:///etc/passwd' }));

    await expect(new SSRFFetcher().fetch('http://good.example/')).rejects.toThrow(
      'Unsupported scheme',
    );
  });

  it('follows a valid redirect to a public IP, re-resolving the new hostname', async () => {
    lookupMock.mockImplementation(async (host: string) => [
      { address: host === 'b.example' ? '151.101.1.69' : PUBLIC_IP, family: 4 },
    ]);
    requestMock
      .mockResolvedValueOnce(respond(301, '', { location: 'https://b.example/final' }))
      .mockResolvedValueOnce(respond(200, 'final body'));

    const result = await new SSRFFetcher().fetch('http://a.example/start');

    expect(result.body).toBe('final body');
    expect(result.status).toBe(200);
    expect(lookupMock).toHaveBeenCalledWith('a.example', expect.anything());
    expect(lookupMock).toHaveBeenCalledWith('b.example', expect.anything());
    expect(requestMock.mock.calls[1]?.[0]).toBe('https://b.example/final');
  });

  it('resolves relative redirect locations', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock
      .mockResolvedValueOnce(respond(302, '', { location: '/moved' }))
      .mockResolvedValueOnce(respond(200, 'ok'));

    await new SSRFFetcher().fetch('http://a.example/start');

    expect(requestMock.mock.calls[1]?.[0]).toBe('http://a.example/moved');
  });

  it('fails after more than 5 redirects', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockImplementation(async () => respond(302, '', { location: '/loop' }));

    await expect(new SSRFFetcher().fetch('http://a.example/')).rejects.toThrow(
      'Too many redirects',
    );
    expect(requestMock).toHaveBeenCalledTimes(6); // initial request + 5 redirects
  });

  it('does not treat a 3xx without a Location header as a redirect', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(304, ''));
    await expect(new SSRFFetcher().fetch('http://a.example/')).resolves.toMatchObject({
      status: 304,
    });
  });

  it('throws "Response too large" when the body exceeds 5 MB', async () => {
    dnsReturns(PUBLIC_IP);
    const chunk = Buffer.alloc(1024 * 1024, 'a');
    requestMock.mockResolvedValue(
      respond(200, Readable.from([chunk, chunk, chunk, chunk, chunk, chunk])),
    );

    await expect(new SSRFFetcher().fetch('http://big.example/')).rejects.toThrow(
      'Response too large',
    );
  });

  it('throws "Response too large" early when Content-Length exceeds the limit', async () => {
    dnsReturns(PUBLIC_IP);
    const body = respond(200, 'x', { 'content-length': String(6 * 1024 * 1024) });
    requestMock.mockResolvedValue(body);

    await expect(new SSRFFetcher().fetch('http://big.example/')).rejects.toThrow(
      'Response too large',
    );
    expect(body.body.destroyed).toBe(true);
  });

  it('accepts a body of exactly 5 MB', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(200, Buffer.alloc(5 * 1024 * 1024, 'a')));

    const result = await new SSRFFetcher().fetch('http://big.example/');
    expect(result.body.length).toBe(5 * 1024 * 1024);
  });

  it('uses a 10 s timeout by default', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockResolvedValue(respond(200, 'ok'));
    const spy = vi.spyOn(AbortSignal, 'timeout');

    await new SSRFFetcher().fetch('http://a.example/');

    expect(spy).toHaveBeenCalledWith(10_000);
    spy.mockRestore();
  });

  it('throws "Request timeout" when the request exceeds the timeout', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockImplementation(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(opts.signal.reason));
        }),
    );

    await expect(new SSRFFetcher({ timeoutMs: 20 }).fetch('http://slow.example/')).rejects.toThrow(
      'Request timeout',
    );
  });

  it('throws "Request timeout" when the body stalls mid-stream', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockImplementation(async (_url: string, opts: { signal: AbortSignal }) => {
      const body = new Readable({ read() {} });
      opts.signal.addEventListener('abort', () => body.destroy(opts.signal.reason as Error));
      body.push('partial');
      return { statusCode: 200, headers: {}, body };
    });

    await expect(new SSRFFetcher({ timeoutMs: 20 }).fetch('http://slow.example/')).rejects.toThrow(
      'Request timeout',
    );
  });

  it('propagates non-timeout network errors', async () => {
    dnsReturns(PUBLIC_IP);
    requestMock.mockRejectedValue(new Error('socket hang up'));
    await expect(new SSRFFetcher().fetch('http://a.example/')).rejects.toThrow('socket hang up');
  });
});
