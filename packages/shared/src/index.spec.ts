import { PRESENCES, SESSION_STATES, VERDICTS } from './index.js';

/**
 * Guard test, not a coverage exercise. CLAUDE.md rule 1 says there is no boolean `verified`,
 * and the cheapest way for that rule to rot is for someone to add a fourth verdict or rename
 * one. This fails loudly if the vocabulary drifts.
 */
describe('shared vocabulary', () => {
  it('exposes exactly the three verdicts from D-001', () => {
    expect([...VERDICTS]).toEqual(['auto_verified', 'needs_review', 'rejected']);
  });

  it('treats unknown presence as a first-class outcome', () => {
    expect(PRESENCES).toContain('unknown');
  });

  it('has no session state implying a boolean verified flag', () => {
    expect([...SESSION_STATES]).toEqual([
      'pending',
      'active',
      'ended',
      'submitted',
      'abandoned',
      'expired',
    ]);
  });
});
