import { describe, it, expect, afterEach } from 'vitest';
import {
  parseBoolEnv,
  getCaller,
  getLocale,
  getUserAgent,
  getConfiguredUserId,
  getRequestTimeoutMs,
  debugLogEnabled,
} from '../src/config.js';
import {
  DEFAULT_CALLER,
  DEFAULT_LOCALE,
  DEFAULT_USER_AGENT,
} from '../src/protocol.js';

const TOUCHED = [
  'ALLTRAILS_CALLER',
  'ALLTRAILS_LOCALE',
  'ALLTRAILS_USER_AGENT',
  'ALLTRAILS_USER_ID',
  'ALLTRAILS_REQUEST_TIMEOUT_MS',
  'ALLTRAILS_DEBUG_LOG',
  'ALLTRAILS_DISABLE_FETCHPROXY',
];

afterEach(() => {
  for (const k of TOUCHED) delete process.env[k];
});

describe('parseBoolEnv', () => {
  it.each(['1', 'true', 'yes', 'on', 'TRUE'])('is true for %j', (v) => {
    process.env.ALLTRAILS_DISABLE_FETCHPROXY = v;
    expect(parseBoolEnv('ALLTRAILS_DISABLE_FETCHPROXY')).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', '', 'garbage'])('is false for %j', (v) => {
    process.env.ALLTRAILS_DISABLE_FETCHPROXY = v;
    expect(parseBoolEnv('ALLTRAILS_DISABLE_FETCHPROXY')).toBe(false);
  });

  it('is false when unset', () => {
    expect(parseBoolEnv('ALLTRAILS_DISABLE_FETCHPROXY')).toBe(false);
  });
});

describe('getCaller / getLocale / getUserAgent', () => {
  it('return defaults when unset', () => {
    expect(getCaller()).toBe(DEFAULT_CALLER);
    expect(getLocale()).toBe(DEFAULT_LOCALE);
    expect(getUserAgent()).toBe(DEFAULT_USER_AGENT);
  });
  it('return overrides when set', () => {
    process.env.ALLTRAILS_CALLER = 'MyCaller';
    process.env.ALLTRAILS_LOCALE = 'fr-FR';
    process.env.ALLTRAILS_USER_AGENT = 'CustomUA/1.0';
    expect(getCaller()).toBe('MyCaller');
    expect(getLocale()).toBe('fr-FR');
    expect(getUserAgent()).toBe('CustomUA/1.0');
  });
});

describe('getConfiguredUserId', () => {
  it('is undefined when unset', () => {
    expect(getConfiguredUserId()).toBeUndefined();
  });
  it('returns the value when set', () => {
    process.env.ALLTRAILS_USER_ID = '12345';
    expect(getConfiguredUserId()).toBe('12345');
  });
});

describe('getRequestTimeoutMs', () => {
  it('defaults to 30000 when unset', () => {
    expect(getRequestTimeoutMs()).toBe(30_000);
  });
  it('uses a valid positive override', () => {
    process.env.ALLTRAILS_REQUEST_TIMEOUT_MS = '5000';
    expect(getRequestTimeoutMs()).toBe(5000);
  });
  it.each(['not-a-number', '0', '-5', '   ', ''])('falls back to default for invalid %j', (v) => {
    process.env.ALLTRAILS_REQUEST_TIMEOUT_MS = v;
    expect(getRequestTimeoutMs()).toBe(30_000);
  });
});

describe('debugLogEnabled', () => {
  it('is false when unset, true when enabled', () => {
    expect(debugLogEnabled()).toBe(false);
    process.env.ALLTRAILS_DEBUG_LOG = 'on';
    expect(debugLogEnabled()).toBe(true);
  });
});
