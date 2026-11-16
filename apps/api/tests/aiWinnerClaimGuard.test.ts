import { describe, it, expect } from 'vitest';
import { claimsOtherOptionWon } from '../src/services/ai/ai.service';

describe('claimsOtherOptionWon (AI false-winner guard)', () => {
  it('detects a plain false winner claim', () => {
    expect(claimsOtherOptionWon('Beta won on cost grounds.', ['Beta'])).toBe(true);
    expect(claimsOtherOptionWon('beta is the winner overall', ['Beta'])).toBe(true);
  });

  it('does not throw on option names containing regex metacharacters', () => {
    expect(() => claimsOtherOptionWon('Nothing to see', ['C++', 'Option (Beta)', '[x]', 'a*b?'])).not.toThrow();
  });

  it('detects claims for names with metacharacters', () => {
    expect(claimsOtherOptionWon('C++ won this round', ['C++'])).toBe(true);
    expect(claimsOtherOptionWon('Clearly Option (Beta) achieved top rank.', ['Option (Beta)'])).toBe(true);
  });

  it('treats metacharacters literally rather than as patterns', () => {
    // "a*b" must not match "aaab won" as it would if '*' were a quantifier.
    expect(claimsOtherOptionWon('aaab won', ['a*b'])).toBe(false);
  });

  it('does not flag names that only appear inside other words or without a win claim', () => {
    expect(claimsOtherOptionWon('Alphabeta won', ['beta'])).toBe(false);
    expect(claimsOtherOptionWon('Beta is cheaper but Alpha leads', ['Beta'])).toBe(false);
  });
});
