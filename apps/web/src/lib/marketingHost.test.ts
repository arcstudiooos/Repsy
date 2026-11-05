import { describe, expect, it } from 'vitest';
import { marketingHostRedirect, parseHosts, requestHost } from './marketingHost';

const env = {
  marketingHosts: ['repsy.fit', 'www.repsy.fit'],
  appBaseUrl: 'https://app.repsy.fit/',
};

describe('marketingHostRedirect', () => {
  it('serves the landing page and assets on the bare domain', () => {
    for (const path of [
      '/',
      '/_next/static/chunks/a.js',
      '/icon.png',
      '/robots.txt',
      '/tour/repsy.mp4',
    ]) {
      expect(marketingHostRedirect('repsy.fit', path, '', env)).toBeNull();
    }
  });

  it('sends every other path to the app, keeping the query', () => {
    expect(marketingHostRedirect('repsy.fit', '/signup', '', env)).toBe(
      'https://app.repsy.fit/signup',
    );
    expect(marketingHostRedirect('www.repsy.fit', '/login', '?next=%2Fapp', env)).toBe(
      'https://app.repsy.fit/login?next=%2Fapp',
    );
    expect(marketingHostRedirect('repsy.fit', '/app/clients', '', env)).toBe(
      'https://app.repsy.fit/app/clients',
    );
  });

  it('leaves the app host and unconfigured setups alone', () => {
    expect(marketingHostRedirect('app.repsy.fit', '/signup', '', env)).toBeNull();
    expect(
      marketingHostRedirect('repsy.fit', '/signup', '', { ...env, marketingHosts: [] }),
    ).toBeNull();
    expect(
      marketingHostRedirect('repsy.fit', '/signup', '', { ...env, appBaseUrl: undefined }),
    ).toBeNull();
  });
});

describe('host helpers', () => {
  it('parses the host list', () => {
    expect(parseHosts(' Repsy.fit, www.repsy.fit ,')).toEqual(['repsy.fit', 'www.repsy.fit']);
    expect(parseHosts(undefined)).toEqual([]);
  });

  it('reads the public host without a port', () => {
    expect(requestHost(new Headers({ host: 'repsy.fit:443' }))).toBe('repsy.fit');
    expect(requestHost(new Headers({ host: 'x', 'x-forwarded-host': 'WWW.repsy.fit' }))).toBe(
      'www.repsy.fit',
    );
  });
});
