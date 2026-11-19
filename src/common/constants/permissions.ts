export const PERMISSION = {
  MANAGE_COMPANIES: 'manage_companies',
  MANAGE_USERS: 'manage_users',
  MANAGE_ROLES: 'manage_roles',
  MANAGE_LEADS: 'manage_leads',
  IMPORT_LEADS: 'import_leads',
  ALLOCATE_LEADS: 'allocate_leads',
  MANAGE_CAMPAIGNS: 'manage_campaigns',
  CALL_ASSIGNED_LEADS: 'call_assigned_leads',
  SUBMIT_DISPOSITION: 'submit_disposition',
  VIEW_MIS: 'view_mis',
  VIEW_REPORTS: 'view_reports',
  EXPORT_DATA: 'export_data',
  VIEW_AUDIT: 'view_audit',
  MANAGE_SETTINGS: 'manage_settings',
  MONITOR_LIVE: 'monitor_live',
  MANAGE_TEAMS: 'manage_teams',
  VIEW_NOTIFICATIONS: 'view_notifications',
} as const;

export type PermissionKey = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ALL_PERMISSIONS: { key: string; displayName: string; module: string }[] = [
  { key: PERMISSION.MANAGE_COMPANIES, displayName: 'Manage Companies', module: 'companies' },
  { key: PERMISSION.MANAGE_USERS, displayName: 'Manage Users', module: 'users' },
  { key: PERMISSION.MANAGE_ROLES, displayName: 'Manage Roles', module: 'roles' },
  { key: PERMISSION.MANAGE_LEADS, displayName: 'Manage Leads', module: 'leads' },
  { key: PERMISSION.IMPORT_LEADS, displayName: 'Import Leads', module: 'leads' },
  { key: PERMISSION.ALLOCATE_LEADS, displayName: 'Allocate Leads', module: 'leads' },
  { key: PERMISSION.MANAGE_CAMPAIGNS, displayName: 'Manage Campaigns', module: 'campaigns' },
  { key: PERMISSION.CALL_ASSIGNED_LEADS, displayName: 'Call Assigned Leads', module: 'dialer' },
  { key: PERMISSION.SUBMIT_DISPOSITION, displayName: 'Submit Disposition', module: 'dialer' },
  { key: PERMISSION.VIEW_MIS, displayName: 'View MIS', module: 'reports' },
  { key: PERMISSION.VIEW_REPORTS, displayName: 'View Reports', module: 'reports' },
  { key: PERMISSION.EXPORT_DATA, displayName: 'Export Data', module: 'reports' },
  { key: PERMISSION.VIEW_AUDIT, displayName: 'View Audit', module: 'audit' },
  { key: PERMISSION.MANAGE_SETTINGS, displayName: 'Manage Settings', module: 'settings' },
  { key: PERMISSION.MONITOR_LIVE, displayName: 'Monitor Live Floor', module: 'dialer' },
  { key: PERMISSION.MANAGE_TEAMS, displayName: 'Manage Teams', module: 'users' },
  { key: PERMISSION.VIEW_NOTIFICATIONS, displayName: 'View Notifications', module: 'notifications' },
];

export const SYSTEM_ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ['*'],
  COMPANY_ADMIN: [
    PERMISSION.MANAGE_USERS,
    PERMISSION.MANAGE_ROLES,
    PERMISSION.MANAGE_LEADS,
    PERMISSION.IMPORT_LEADS,
    PERMISSION.ALLOCATE_LEADS,
    PERMISSION.MANAGE_CAMPAIGNS,
    PERMISSION.VIEW_MIS,
    PERMISSION.VIEW_REPORTS,
    PERMISSION.EXPORT_DATA,
    PERMISSION.VIEW_AUDIT,
    PERMISSION.MANAGE_SETTINGS,
    PERMISSION.MONITOR_LIVE,
    PERMISSION.MANAGE_TEAMS,
    PERMISSION.VIEW_NOTIFICATIONS,
  ],
  CEO: [PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS, PERMISSION.EXPORT_DATA, PERMISSION.VIEW_NOTIFICATIONS],
  OPS_HEAD: [
    PERMISSION.MANAGE_CAMPAIGNS,
    PERMISSION.MANAGE_LEADS,
    PERMISSION.IMPORT_LEADS,
    PERMISSION.ALLOCATE_LEADS,
    PERMISSION.VIEW_MIS,
    PERMISSION.MONITOR_LIVE,
    PERMISSION.MANAGE_USERS,
    PERMISSION.VIEW_NOTIFICATIONS,
  ],
  STATE_HEAD: [PERMISSION.VIEW_MIS, PERMISSION.VIEW_REPORTS, PERMISSION.MONITOR_LIVE],
  BRANCH_MANAGER: [PERMISSION.MANAGE_LEADS, PERMISSION.VIEW_MIS, PERMISSION.MONITOR_LIVE, PERMISSION.ALLOCATE_LEADS],
  TEAM_LEADER: [
    PERMISSION.CALL_ASSIGNED_LEADS,
    PERMISSION.SUBMIT_DISPOSITION,
    PERMISSION.ALLOCATE_LEADS,
    PERMISSION.VIEW_MIS,
    PERMISSION.MONITOR_LIVE,
    PERMISSION.VIEW_NOTIFICATIONS,
  ],
  TELECALLER: [
    PERMISSION.CALL_ASSIGNED_LEADS,
    PERMISSION.SUBMIT_DISPOSITION,
    PERMISSION.VIEW_NOTIFICATIONS,
  ],
  MIS_EXECUTIVE: [PERMISSION.VIEW_REPORTS, PERMISSION.EXPORT_DATA, PERMISSION.VIEW_MIS],
  COMPLIANCE_OFFICER: [PERMISSION.VIEW_AUDIT, PERMISSION.VIEW_REPORTS],
};

export function hasPermission(permissions: unknown, required: string | string[]): boolean {
  const list = Array.isArray(permissions) ? permissions.map(String) : [];
  if (list.includes('*')) return true;
  const needed = Array.isArray(required) ? required : [required];
  return needed.some((p) => list.includes(p) || list.includes('manage_*'));
}
