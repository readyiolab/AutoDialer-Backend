import { generateInviteToken, hashInviteToken, invitationExpiry } from './invitation';

describe('invitation utils', () => {
  it('generates unique tokens', () => {
    expect(generateInviteToken()).not.toEqual(generateInviteToken());
  });

  it('hashes consistently', () => {
    const t = 'abc';
    expect(hashInviteToken(t)).toEqual(hashInviteToken(t));
    expect(hashInviteToken(t)).not.toEqual(t);
  });

  it('expiry is in the future', () => {
    expect(invitationExpiry(1).getTime()).toBeGreaterThan(Date.now());
  });
});
