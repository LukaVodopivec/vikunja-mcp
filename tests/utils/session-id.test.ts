import { buildSessionId } from '../../src/utils/session-id';

describe('buildSessionId', () => {
  it('returns anonymous when token is missing', () => {
    expect(buildSessionId('https://vikunja.local/api/v1')).toBe('anonymous');
    expect(buildSessionId('https://vikunja.local/api/v1', '')).toBe('anonymous');
  });

  it('is stable for the same apiUrl/token pair', () => {
    const first = buildSessionId('https://vikunja.local/api/v1', 'tk_same_token');
    const second = buildSessionId('https://vikunja.local/api/v1', 'tk_same_token');

    expect(first).toBe(second);
    expect(first).toMatch(/^https:\/\/vikunja\.local\/api\/v1:[a-f0-9]{16}$/);
  });

  it('changes when token changes', () => {
    const first = buildSessionId('https://vikunja.local/api/v1', 'tk_token_a');
    const second = buildSessionId('https://vikunja.local/api/v1', 'tk_token_b');

    expect(first).not.toBe(second);
  });
});
