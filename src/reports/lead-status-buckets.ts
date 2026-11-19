import { LeadStatus } from '@prisma/client';

/** Display buckets used by telecaller overview + productivity MIS */
export type LeadBucket =
  | 'pending'
  | 'followUp'
  | 'interested'
  | 'converted'
  | 'rejected'
  | 'invalid'
  | 'contacted';

export const BUCKET_STATUSES: Record<LeadBucket, LeadStatus[]> = {
  pending: [
    LeadStatus.NEW,
    LeadStatus.ASSIGNED,
    LeadStatus.PENDING,
    LeadStatus.NOT_CONTACTED,
  ],
  followUp: [LeadStatus.FOLLOW_UP_REQUIRED, LeadStatus.CALL_BACK],
  interested: [
    LeadStatus.INTERESTED,
    LeadStatus.DOCUMENTS_REQUIRED,
    LeadStatus.PAYMENT_PROMISED,
    LeadStatus.LOAN_REQUIRED,
  ],
  converted: [LeadStatus.CONVERTED, LeadStatus.APPLICATION_SUBMITTED],
  rejected: [LeadStatus.NOT_INTERESTED, LeadStatus.LOST, LeadStatus.CLOSED, LeadStatus.DND],
  invalid: [LeadStatus.INVALID_NUMBER],
  contacted: [
    LeadStatus.CONTACTED,
    LeadStatus.BUSY,
    LeadStatus.NO_ANSWER,
    LeadStatus.SWITCHED_OFF,
  ],
};

export const NOT_INTERESTED_STATUSES: LeadStatus[] = [LeadStatus.NOT_INTERESTED];

export function bucketForStatus(status: LeadStatus | string | null | undefined): LeadBucket | null {
  if (!status) return null;
  const s = String(status) as LeadStatus;
  for (const [bucket, statuses] of Object.entries(BUCKET_STATUSES) as [LeadBucket, LeadStatus[]][]) {
    if (statuses.includes(s)) return bucket;
  }
  return null;
}

export function statusesForBucket(bucket?: string | null): LeadStatus[] | undefined {
  if (!bucket) return undefined;
  if (bucket === 'notInterested') return NOT_INTERESTED_STATUSES;
  const key = bucket as LeadBucket;
  return BUCKET_STATUSES[key];
}

export function emptyBucketCounts() {
  return {
    pending: 0,
    followUp: 0,
    interested: 0,
    converted: 0,
    rejected: 0,
    invalid: 0,
    contacted: 0,
  };
}

export function incrementBucket(
  counts: ReturnType<typeof emptyBucketCounts>,
  status: LeadStatus | string,
  n = 1,
) {
  const bucket = bucketForStatus(status);
  if (!bucket) return;
  counts[bucket] += n;
}

export function isConvertedStatus(status: LeadStatus | string | null | undefined): boolean {
  return bucketForStatus(status) === 'converted';
}

export function isPendingStatus(status: LeadStatus | string | null | undefined): boolean {
  return bucketForStatus(status) === 'pending';
}
