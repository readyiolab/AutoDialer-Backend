import { createHash, randomBytes } from 'crypto';

export function generateInviteToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationExpiry(hours = 48): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function buildInviteUrl(token: string): string {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/accept-invite?token=${token}`;
}
