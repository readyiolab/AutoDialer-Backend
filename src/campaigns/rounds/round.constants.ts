import { LeadStatus } from '@prisma/client';

/** Statuses that must never enter a new calling round. */
export const NON_RECYCLABLE_STATUSES: LeadStatus[] = [
  LeadStatus.DND,
  LeadStatus.INVALID_NUMBER,
  LeadStatus.EXCLUDED,
  LeadStatus.CONVERTED,
];

/** Default statuses offered when creating Round N+1. */
export const DEFAULT_RECYCLE_STATUSES: LeadStatus[] = [
  LeadStatus.FOLLOW_UP_REQUIRED,
  LeadStatus.CALL_BACK,
  LeadStatus.NO_ANSWER,
  LeadStatus.BUSY,
  LeadStatus.SWITCHED_OFF,
  LeadStatus.NOT_REACHABLE,
  LeadStatus.PENDING,
  LeadStatus.NOT_CONTACTED,
  LeadStatus.CONTACTED,
];

export const PRODUCT_STATUS_LABELS: Record<string, string> = {
  NEW: 'Pending',
  ASSIGNED: 'Pending',
  PENDING: 'Pending',
  NOT_CONTACTED: 'Pending',
  INTERESTED: 'Interested',
  NOT_INTERESTED: 'Not Interested',
  FOLLOW_UP_REQUIRED: 'Follow-up Required',
  CALL_BACK: 'Call Back Later',
  NO_ANSWER: 'No Answer',
  BUSY: 'Busy',
  SWITCHED_OFF: 'Switched Off',
  NOT_REACHABLE: 'Not Reachable',
  INVALID_NUMBER: 'Invalid Number',
  DND: 'Do Not Call',
  EXCLUDED: 'Excluded',
  CONVERTED: 'Converted',
  CONTACTED: 'Contacted',
  LOST: 'Lost',
  CLOSED: 'Closed',
  DOCUMENTS_REQUIRED: 'Documents Required',
  APPLICATION_SUBMITTED: 'Application Submitted',
  PAYMENT_PROMISED: 'Payment Promised',
  LOAN_REQUIRED: 'Loan Required',
};

export function isRecyclableStatus(status: LeadStatus | string): boolean {
  return !NON_RECYCLABLE_STATUSES.includes(status as LeadStatus);
}
