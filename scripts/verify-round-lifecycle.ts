/**
 * Smoke verification of round eligibility rules (no DB required).
 * Run: npx ts-node scripts/verify-round-lifecycle.ts
 */
import { LeadStatus } from '@prisma/client';
import {
  DEFAULT_RECYCLE_STATUSES,
  isRecyclableStatus,
  NON_RECYCLABLE_STATUSES,
} from '../src/campaigns/rounds/round.constants';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const sampleRound1Outcomes: LeadStatus[] = [
  LeadStatus.FOLLOW_UP_REQUIRED,
  LeadStatus.CALL_BACK,
  LeadStatus.NO_ANSWER,
  LeadStatus.BUSY,
  LeadStatus.SWITCHED_OFF,
  LeadStatus.DND,
  LeadStatus.INVALID_NUMBER,
  LeadStatus.CONVERTED,
  LeadStatus.EXCLUDED,
  LeadStatus.INTERESTED,
];

const eligible = sampleRound1Outcomes.filter(
  (s) => DEFAULT_RECYCLE_STATUSES.includes(s) && isRecyclableStatus(s),
);

assert(eligible.length === 5, `expected 5 recyclable soft outcomes, got ${eligible.length}`);
assert(
  !eligible.some((s) => NON_RECYCLABLE_STATUSES.includes(s)),
  'non-recyclable leaked into eligible set',
);

const uniqueIds = new Set(['a', 'b', 'c', 'a']);
assert(uniqueIds.size === 3, 'round membership uniqueness simulation failed');

console.log('verify-round-lifecycle: OK');
console.log(
  JSON.stringify(
    {
      eligibleStatuses: eligible,
      blocked: NON_RECYCLABLE_STATUSES,
      uniqueMembershipCheck: uniqueIds.size,
    },
    null,
    2,
  ),
);
