import { describe, expect, it } from 'vitest';
import {
  MINIMUM_ADMIN_PASSWORD_LENGTH,
  UserManagementError,
  validateAdminEmail,
  validateAdminPassword,
} from '../src/lib/server/users';

describe('user management validation', () => {
  it('accepts valid normalized email addresses', () => {
    expect(validateAdminEmail('  Admin@Miracon.gr ')).toBe('admin@miracon.gr');
    expect(validateAdminEmail('editor.one@example.com')).toBe('editor.one@example.com');
  });

  it('rejects invalid email addresses', () => {
    expect(() => validateAdminEmail('')).toThrow(UserManagementError);
    expect(() => validateAdminEmail('not-an-email')).toThrow(UserManagementError);
    expect(() => validateAdminEmail('@miracon.gr')).toThrow(UserManagementError);
  });

  it('accepts passwords with at least 16 non-whitespace characters', () => {
    expect(() => validateAdminPassword('1234567890123456')).not.toThrow();
    expect(() => validateAdminPassword('  valid-secure-password-16-chars  ')).not.toThrow();
  });

  it('rejects passwords with fewer than 16 non-whitespace characters', () => {
    expect(() => validateAdminPassword('short')).toThrow(UserManagementError);
    expect(() => validateAdminPassword('123456789012345')).toThrow(UserManagementError);
    expect(() => validateAdminPassword('       spaces-only-12       ')).toThrow(UserManagementError);
  });
});
