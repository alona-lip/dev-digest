import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { UrlFetcher, UrlFetchOptions, UrlFetchResult } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';

/**
 * Outbound fetch for user-supplied URLs (skill import). The URL comes from a
 * user and the API runs next to a local network and maybe a cloud metadata
 * endpoint, so every hop is checked (server/specs/skill-import-url.md):
 *
 * - https only, at most MAX_REDIRECTS redirects, each re-checked;
 * - the address the socket ACTUALLY connects to must be public: the check sits
 *   in the request's `lookup`, so a DNS answer can't change between check and
 *   connect (rebinding), and IP literals are checked before the request;
 * - a deadline over the whole chain, and the body is cut off past `maxBytes`.
 */

const MAX_REDIRECTS = 3;
const USER_AGENT = 'DevDigest-skill-import';

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

const BLOCKED_V6: [string, number][] = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b::', 96], // NAT64 (embeds an IPv4 address)
  ['100::', 64], // discard
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

const blockList = new net.BlockList();
for (const [a, p] of BLOCKED_V4) blockList.addSubnet(a, p, 'ipv4');
for (const [a, p] of BLOCKED_V6) blockList.addSubnet(a, p, 'ipv6');

/** The IPv4 address inside an IPv4-mapped/compatible IPv6 address (`::ffff:a.b.c.d`, `::ffff:7f00:1`), else null. */
function embeddedV4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return dotted[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

/** True for any address that is not a public unicast address. Unparseable → blocked. */
export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0]!;
  const family = net.isIP(bare);
  if (family === 4) return blockList.check(bare, 'ipv4');
  if (family === 6) {
    const v4 = embeddedV4(bare);
    if (v4) return blockList.check(v4, 'ipv4');
    return blockList.check(bare, 'ipv6');
  }
  return true;
}

const blocked = () => new ValidationError('That address is not allowed (local or private network)');

/** `lookup` for https.request: resolve, then refuse the hop if ANY answer is non-public. */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as unknown as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(blocked() as unknown as NodeJS.ErrnoException, '', 0);
    }
    if ((options as dns.LookupOptions).all) {
      return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    }
    callback(null, list[0]!.address, list[0]!.family);
  });
};

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('Not a valid URL');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Only https:// URLs can be fetched');
  if (url.username || url.password) throw new ValidationError('URLs with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) throw blocked();
  return url;
}

function networkError(err: unknown): Error {
  if (err instanceof ValidationError) return err;
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ValidationError('Host not found');
  return new ValidationError(`Could not fetch the URL${code ? ` (${code})` : ''}`);
}

export class SafeUrlFetcher implements UrlFetcher {
  async fetch(rawUrl: string, opts: UrlFetchOptions): Promise<UrlFetchResult> {
    const deadline = Date.now() + opts.timeoutMs;
    let url = checkUrl(rawUrl);
    for (let hop = 0; ; hop++) {
      const res = await this.get(url, deadline);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (hop >= MAX_REDIRECTS) throw new ValidationError('Too many redirects');
        url = checkUrl(new URL(res.headers.location, url).toString());
        continue;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        throw new ValidationError(`The URL returned HTTP ${status}`);
      }
      const bytes = await this.readBody(res, opts.maxBytes, deadline);
      const ct = res.headers['content-type'];
      return { bytes, finalUrl: url.toString(), contentType: typeof ct === 'string' ? ct : null };
    }
  }

  private get(url: URL, deadline: number): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return reject(new ValidationError('The URL took too long to respond'));
      const req = https.get(url, {
        lookup: safeLookup,
        headers: { 'user-agent': USER_AGENT, accept: 'text/markdown, text/plain, application/zip;q=0.9, */*;q=0.5' },
      });
      const timer = setTimeout(() => req.destroy(new ValidationError('The URL took too long to respond')), remaining);
      req.on('response', (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      req.on('error', (err) => {
        clearTimeout(timer);
        reject(networkError(err));
      });
    });
  }

  private readBody(res: IncomingMessage, maxBytes: number, deadline: number): Promise<Uint8Array> {
    const tooLarge = () => new ValidationError(`File is larger than ${Math.round(maxBytes / 1024)} KB`);
    const declared = Number(res.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy();
      return Promise.reject(tooLarge());
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const timer = setTimeout(
        () => res.destroy(new ValidationError('The URL took too long to respond')),
        Math.max(0, deadline - Date.now()),
      );
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          res.destroy(tooLarge());
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        clearTimeout(timer);
        resolve(new Uint8Array(Buffer.concat(chunks)));
      });
      res.on('error', (err) => {
        clearTimeout(timer);
        reject(networkError(err));
      });
    });
  }
}
