import { describe, it, expect } from 'vitest';
import { isBlockedAddress, SafeUrlFetcher } from '../src/adapters/http/safe-fetch.js';
import { ValidationError } from '../src/platform/errors.js';

describe('isBlockedAddress', () => {
  it('blocks loopback, private, link-local/metadata, CGNAT, multicast and reserved IPv4', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    ]) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, true]);
    }
  });

  it('blocks local IPv6 and IPv4 hidden in IPv6', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '[::1]', '64:ff9b::a9fe:a9fe']) {
      expect([ip, isBlockedAddress(ip)]).toEqual([ip, true]);
    }
  });

  it('allows public unicast and blocks anything unparseable', () => {
    expect(isBlockedAddress('140.82.112.3')).toBe(false);
    expect(isBlockedAddress('172.32.0.1')).toBe(false);
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false);
    expect(isBlockedAddress('not-an-ip')).toBe(true);
  });
});

describe('SafeUrlFetcher', () => {
  const fetcher = new SafeUrlFetcher();
  const opts = { maxBytes: 1024, timeoutMs: 2000 };

  it('refuses non-https, credentials and private IP literals before any request', async () => {
    await expect(fetcher.fetch('http://example.com/x.md', opts)).rejects.toThrow(/https/);
    await expect(fetcher.fetch('https://u:p@example.com/x.md', opts)).rejects.toThrow(/credentials/);
    await expect(fetcher.fetch('https://169.254.169.254/latest/meta-data', opts)).rejects.toThrow(/not allowed/);
    await expect(fetcher.fetch('https://[::1]/x.md', opts)).rejects.toThrow(/not allowed/);
  });

  it('refuses a hostname that resolves to a local address (checked in lookup)', async () => {
    const err = await fetcher.fetch('https://localhost/x.md', opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toMatch(/not allowed/);
  });
});
