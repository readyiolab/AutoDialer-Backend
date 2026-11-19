const FORBIDDEN_DEFAULT = 'autodial-jwt-secret-change-in-production';

export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === FORBIDDEN_DEFAULT) {
    throw new Error(
      'JWT_SECRET must be set to a strong non-default value before starting the server',
    );
  }
  return secret;
}
