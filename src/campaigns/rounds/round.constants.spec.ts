import { LeadStatus } from '@prisma/client';
import {
  DEFAULT_RECYCLE_STATUSES,
  isRecyclableStatus,
  NON_RECYCLABLE_STATUSES,
} from './round.constants';

describe('round.constants', () => {
  it('blocks DND, invalid, excluded, converted from recycling', () => {
    expect(isRecyclableStatus(LeadStatus.DND)).toBe(false);
    expect(isRecyclableStatus(LeadStatus.INVALID_NUMBER)).toBe(false);
    expect(isRecyclableStatus(LeadStatus.EXCLUDED)).toBe(false);
    expect(isRecyclableStatus(LeadStatus.CONVERTED)).toBe(false);
  });

  it('allows soft outcomes for next round', () => {
    expect(isRecyclableStatus(LeadStatus.NO_ANSWER)).toBe(true);
    expect(isRecyclableStatus(LeadStatus.BUSY)).toBe(true);
    expect(isRecyclableStatus(LeadStatus.CALL_BACK)).toBe(true);
    expect(isRecyclableStatus(LeadStatus.FOLLOW_UP_REQUIRED)).toBe(true);
  });

  it('keeps default recycle list free of permanent blocks', () => {
    for (const s of DEFAULT_RECYCLE_STATUSES) {
      expect(NON_RECYCLABLE_STATUSES).not.toContain(s);
    }
  });
});
