import { buildAssignmentPlan } from './allocation.engine';

const agents = [
  { userId: 'a', openLeads: 0, dailyTarget: 100, connected: 10, converted: 2, onBreak: false },
  { userId: 'b', openLeads: 5, dailyTarget: 100, connected: 20, converted: 5, onBreak: false },
  { userId: 'c', openLeads: 0, dailyTarget: 50, connected: 1, converted: 0, onBreak: true },
];

const leads = [
  { id: '1', priority: 'HIGH' as const },
  { id: '2', priority: 'LOW' as const },
  { id: '3', priority: 'URGENT' as const },
  { id: '4', priority: 'MEDIUM' as const },
];

describe('buildAssignmentPlan', () => {
  it('equal distributes round-robin', () => {
    const plan = buildAssignmentPlan(leads, agents, 'EQUAL', { excludeOnBreak: false } as any);
    expect(plan.size).toBe(4);
    expect(new Set(plan.values()).size).toBeGreaterThan(1);
  });

  it('manual map assigns specified users', () => {
    const plan = buildAssignmentPlan(leads, agents, 'MANUAL', {
      manualMap: { '1': 'a', '2': 'b' },
    });
    expect(plan.get('1')).toBe('a');
    expect(plan.get('2')).toBe('b');
  });

  it('respects maxPerUser', () => {
    const plan = buildAssignmentPlan(leads, agents, 'EQUAL', { maxPerUser: 1 });
    const counts = Array.from(plan.values()).reduce((m, id) => {
      m[id] = (m[id] || 0) + 1;
      return m;
    }, {} as Record<string, number>);
    Object.values(counts).forEach((n) => expect(n).toBeLessThanOrEqual(1));
  });

  it('performance prefers stronger agents for priority leads', () => {
    const plan = buildAssignmentPlan(leads, agents, 'PERFORMANCE');
    expect(plan.get('3')).toBe('b');
  });

  it('availability skips agents on break when others exist', () => {
    const plan = buildAssignmentPlan(leads, agents, 'AVAILABILITY');
    expect([...plan.values()].includes('c')).toBe(false);
  });
});
