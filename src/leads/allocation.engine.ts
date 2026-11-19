import { AllocationMethod, LeadPriority } from '@prisma/client';

export type AgentScore = {
  userId: string;
  openLeads: number;
  dailyTarget: number;
  connected: number;
  converted: number;
  onBreak: boolean;
  percentage?: number;
};

export type LeadSlice = {
  id: string;
  priority: LeadPriority;
};

const PRIORITY_WEIGHT: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function buildAssignmentPlan(
  leads: LeadSlice[],
  agents: AgentScore[],
  method: AllocationMethod | string,
  opts: {
    maxPerUser?: number;
    percentages?: Record<string, number>;
    manualMap?: Record<string, string>;
    targetCounts?: Record<string, number>;
  } = {},
): Map<string, string> {
  const plan = new Map<string, string>();
  if (!leads.length || !agents.length) return plan;

  let eligible = agents.filter((a) => !a.onBreak);
  if (!eligible.length) eligible = [...agents];

  const assignedCount = new Map<string, number>(eligible.map((a) => [a.userId, 0]));

  const canTake = (userId: string) => {
    const agent = eligible.find((a) => a.userId === userId);
    if (!agent) return false;
    const current = (assignedCount.get(userId) || 0) + agent.openLeads;
    if (opts.maxPerUser && current >= opts.maxPerUser) return false;
    if (agent.dailyTarget && current >= agent.dailyTarget * 2) return false;
    return true;
  };

  if (opts.targetCounts && Object.keys(opts.targetCounts).length) {
    let leadIdx = 0;
    for (const a of eligible) {
      let remaining = Math.max(0, Math.floor(opts.targetCounts[a.userId] || 0));
      while (remaining > 0 && leadIdx < leads.length) {
        if (canTake(a.userId)) {
          plan.set(leads[leadIdx].id, a.userId);
          assignedCount.set(a.userId, (assignedCount.get(a.userId) || 0) + 1);
          remaining--;
        }
        leadIdx++;
      }
    }
    while (leadIdx < leads.length) {
      const least = [...eligible]
        .filter((a) => canTake(a.userId))
        .sort(
          (a, b) =>
            (assignedCount.get(a.userId) || 0) - (assignedCount.get(b.userId) || 0),
        )[0];
      if (!least) break;
      plan.set(leads[leadIdx].id, least.userId);
      assignedCount.set(least.userId, (assignedCount.get(least.userId) || 0) + 1);
      leadIdx++;
    }
    return plan;
  }

  if (method === 'MANUAL' && opts.manualMap) {
    for (const lead of leads) {
      const userId = opts.manualMap[lead.id];
      if (userId && canTake(userId)) {
        plan.set(lead.id, userId);
        assignedCount.set(userId, (assignedCount.get(userId) || 0) + 1);
      }
    }
    return plan;
  }

  if (method === 'EQUAL' || method === 'ROUND_ROBIN' || method === 'TEAM') {
    let idx = 0;
    for (const lead of leads) {
      let tries = 0;
      while (tries < eligible.length) {
        const agent = eligible[idx % eligible.length];
        idx++;
        tries++;
        if (canTake(agent.userId)) {
          plan.set(lead.id, agent.userId);
          assignedCount.set(agent.userId, (assignedCount.get(agent.userId) || 0) + 1);
          break;
        }
      }
    }
    return plan;
  }

  if (method === 'CAPACITY_BASED' || method === 'WORKLOAD') {
    const sortedLeads = [...leads];
    for (const lead of sortedLeads) {
      const ranked = [...eligible]
        .filter((a) => canTake(a.userId))
        .sort((a, b) => {
          const aLoad = a.openLeads + (assignedCount.get(a.userId) || 0);
          const bLoad = b.openLeads + (assignedCount.get(b.userId) || 0);
          const aCap = Math.max(a.dailyTarget - aLoad, 0);
          const bCap = Math.max(b.dailyTarget - bLoad, 0);
          return bCap - aCap || aLoad - bLoad;
        });
      if (!ranked.length) break;
      const pick = ranked[0];
      plan.set(lead.id, pick.userId);
      assignedCount.set(pick.userId, (assignedCount.get(pick.userId) || 0) + 1);
    }
    return plan;
  }

  if (method === 'PERFORMANCE' || method === 'PRIORITY_BASED') {
    const sortedLeads = [...leads].sort(
      (a, b) => (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0),
    );
    const rankedAgents = [...eligible].sort((a, b) => {
      const aScore = a.connected * 2 + a.converted * 5;
      const bScore = b.connected * 2 + b.converted * 5;
      return bScore - aScore;
    });
    let idx = 0;
    for (const lead of sortedLeads) {
      let tries = 0;
      while (tries < rankedAgents.length) {
        const agent = rankedAgents[idx % rankedAgents.length];
        idx++;
        tries++;
        if (canTake(agent.userId)) {
          plan.set(lead.id, agent.userId);
          assignedCount.set(agent.userId, (assignedCount.get(agent.userId) || 0) + 1);
          break;
        }
      }
    }
    return plan;
  }

  if (method === 'AVAILABILITY') {
    const available = eligible.filter((a) => !a.onBreak);
    const pool = available.length ? available : eligible;
    let idx = 0;
    for (const lead of leads) {
      let tries = 0;
      while (tries < pool.length) {
        const agent = pool[idx % pool.length];
        idx++;
        tries++;
        if (canTake(agent.userId)) {
          plan.set(lead.id, agent.userId);
          assignedCount.set(agent.userId, (assignedCount.get(agent.userId) || 0) + 1);
          break;
        }
      }
    }
    return plan;
  }

  if (method === 'HYBRID' || opts.percentages) {
    const percentages = opts.percentages || {};
    const totalPct = Object.values(percentages).reduce((s, n) => s + n, 0) || 100;
    const quotas = new Map<string, number>();
    for (const a of eligible) {
      const pct = percentages[a.userId] ?? 100 / eligible.length;
      quotas.set(a.userId, Math.floor((pct / totalPct) * leads.length));
    }
    let leadIdx = 0;
    for (const a of eligible) {
      let q = quotas.get(a.userId) || 0;
      while (q > 0 && leadIdx < leads.length) {
        if (canTake(a.userId)) {
          plan.set(leads[leadIdx].id, a.userId);
          assignedCount.set(a.userId, (assignedCount.get(a.userId) || 0) + 1);
          q--;
        }
        leadIdx++;
      }
    }
    while (leadIdx < leads.length) {
      const least = [...eligible]
        .filter((a) => canTake(a.userId))
        .sort(
          (a, b) =>
            (assignedCount.get(a.userId) || 0) - (assignedCount.get(b.userId) || 0),
        )[0];
      if (!least) break;
      plan.set(leads[leadIdx].id, least.userId);
      assignedCount.set(least.userId, (assignedCount.get(least.userId) || 0) + 1);
      leadIdx++;
    }
    return plan;
  }

  // default equal
  return buildAssignmentPlan(leads, agents, 'EQUAL', opts);
}
