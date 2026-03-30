/**
 * Input sanitization behavior tests.
 *
 * Trust boundary:
 * - This layer validates structure/type/length only.
 * - It does not content-filter or entity-encode user text.
 */

import { sanitizeString, validateValue, safeJsonStringify, safeJsonParse } from '../../src/utils/validation';
import { sanitizeLogData } from '../../src/utils/security';
import { MCPError, ErrorCode } from '../../src/types/errors';

describe('Input Sanitization Trust Boundary', () => {
  describe('sanitizeString', () => {
    it('allows text that previously matched WAF-style keyword filters', () => {
      const samples = [
        'Create task via curl and SSH',
        'Update/Delete format notes',
        '`curl https://example.test/api`',
        'Run: ssh admin@host && echo done',
      ];

      samples.forEach((sample) => {
        expect(sanitizeString(sample)).toBe(sample);
      });
    });

    it('preserves special characters exactly (no HTML entity encoding)', () => {
      const input = 'A & B / path\\to\\file <tag> "quote" \'single\' `code` = value';
      expect(sanitizeString(input)).toBe(input);
      expect(sanitizeString(input)).toContain('&');
      expect(sanitizeString(input)).toContain('/');
      expect(sanitizeString(input)).not.toContain('&amp;');
      expect(sanitizeString(input)).not.toContain('&#x2F;');
    });

    it('still enforces type and max-length constraints', () => {
      expect(() => sanitizeString(123 as unknown as string)).toThrow(MCPError);
      expect(() => sanitizeString('a'.repeat(1001))).toThrow(
        new MCPError(ErrorCode.VALIDATION_ERROR, 'String value exceeds maximum length of 1000'),
      );
    });
  });

  describe('validateValue', () => {
    it('accepts arrays containing command/code-like text', () => {
      const values = ['Create', 'Update', 'Delete', 'curl', 'SSH', '<script>alert(1)</script>'];
      expect(validateValue(values)).toEqual(values);
    });
  });

  describe('safeJson stringify/parse', () => {
    it('preserves filter string values without content mutation', () => {
      const expression = {
        groups: [
          {
            operator: '&&',
            conditions: [
              {
                field: 'description',
                operator: 'like',
                value: 'Create & Update /tmp with `curl` and <script>alert(1)</script>',
              },
            ],
          },
        ],
      };

      const json = safeJsonStringify(expression);
      const parsed = safeJsonParse(json);

      expect(parsed.groups[0]?.conditions[0]?.value).toBe(
        'Create & Update /tmp with `curl` and <script>alert(1)</script>',
      );
      expect(json).toContain('<script>alert(1)</script>');
      expect(json).toContain('&');
    });
  });

  describe('log sanitization', () => {
    it('continues masking credentials while preserving non-sensitive text', () => {
      const sanitized = sanitizeLogData({
        message: '<script>alert(1)</script> Create/Update',
        api_token: 'tk_abcdefghijklmnopqrstuvwxyz',
      }) as Record<string, unknown>;

      expect(sanitized.message).toBe('<script>alert(1)</script> Create/Update');
      expect(typeof sanitized.api_token).toBe('string');
      expect((sanitized.api_token as string).endsWith('...') || sanitized.api_token === '[REDACTED]').toBe(true);
    });
  });
});
