import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';

describe('link do pre-save', () => {
  it('aponta para o pre-save do EP, em https', () => {
    const url = new URL(CONFIG.links.preSave);
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('ffm.to');
  });
});
