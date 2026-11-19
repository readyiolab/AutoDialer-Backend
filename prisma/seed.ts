import { PrismaClient, LeadStatus, LeadPriority, LeadSource, CampaignStatus, CallDisposition, CallCategory, MessageType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding AutoDial Pro Database...');

  // 1. Create Demo Company
  const company = await prisma.company.upsert({
    where: { code: 'ADEMO' },
    update: { status: 'ACTIVE', isActive: true },
    create: {
      name: 'AutoDial Financial Services Ltd.',
      code: 'ADEMO',
      contactName: 'Aditya Sharma',
      email: 'admin@autodialpro.in',
      phone: '9999999999',
      address: 'Cyber City, Phase 2, Gurugram, Haryana',
      status: 'ACTIVE',
      isActive: true,
    },
  });

  console.log(`Company created: ${company.name}`);

  // 2. Create Roles with granular permissions
  const rolesData = [
    { name: 'SUPER_ADMIN', displayName: 'Super Admin', permissions: ['*'] },
    {
      name: 'COMPANY_ADMIN',
      displayName: 'Company Admin',
      permissions: [
        'manage_users', 'manage_roles', 'manage_leads', 'import_leads', 'allocate_leads',
        'manage_campaigns', 'view_mis', 'view_reports', 'export_data', 'view_audit',
        'manage_settings', 'monitor_live', 'manage_teams', 'view_notifications',
      ],
    },
    { name: 'CEO', displayName: 'CEO / Management', permissions: ['view_mis', 'view_reports', 'export_data', 'view_notifications'] },
    {
      name: 'OPS_HEAD',
      displayName: 'Operations Head',
      permissions: [
        'manage_campaigns', 'manage_leads', 'import_leads', 'allocate_leads', 'view_mis',
        'monitor_live', 'manage_users', 'view_notifications',
      ],
    },
    { name: 'STATE_HEAD', displayName: 'State Head', permissions: ['view_mis', 'view_reports', 'monitor_live'] },
    { name: 'BRANCH_MANAGER', displayName: 'Branch Manager', permissions: ['manage_leads', 'view_mis', 'monitor_live', 'allocate_leads'] },
    {
      name: 'TEAM_LEADER',
      displayName: 'Team Leader',
      permissions: [
        'call_assigned_leads', 'submit_disposition', 'allocate_leads', 'view_mis',
        'monitor_live', 'view_notifications',
      ],
    },
    {
      name: 'TELECALLER',
      displayName: 'Telecaller',
      permissions: ['call_assigned_leads', 'submit_disposition', 'view_notifications'],
    },
    { name: 'MIS_EXECUTIVE', displayName: 'MIS Executive', permissions: ['view_reports', 'export_data', 'view_mis'] },
    { name: 'COMPLIANCE_OFFICER', displayName: 'Compliance Officer', permissions: ['view_audit', 'view_reports'] },
  ];

  const rolesMap = new Map<string, string>();
  for (const r of rolesData) {
    const role = await prisma.role.upsert({
      where: { name_companyId: { name: r.name, companyId: company.id } },
      update: { permissions: r.permissions },
      create: {
        name: r.name,
        displayName: r.displayName,
        permissions: r.permissions,
        isSystem: true,
        companyId: company.id,
      },
    });
    rolesMap.set(r.name, role.id);
  }

  // 3. Create Branches
  const branches = [
    { name: 'Delhi HQ', code: 'DEL01', state: 'Delhi', city: 'New Delhi' },
    { name: 'Mumbai Branch', code: 'MUM01', state: 'Maharashtra', city: 'Mumbai' },
    { name: 'Bangalore Branch', code: 'BLR01', state: 'Karnataka', city: 'Bangalore' },
  ];

  const branchMap = new Map<string, string>();
  for (const b of branches) {
    const branch = await prisma.branch.upsert({
      where: { code_companyId: { code: b.code, companyId: company.id } },
      update: {},
      create: { ...b, companyId: company.id },
    });
    branchMap.set(b.code, branch.id);
  }

  // 4. Create Departments
  const departments = ['Personal Loans', 'Payday Loans', 'Collection & Recovery', 'Customer Support'];
  const deptMap = new Map<string, string>();
  for (const d of departments) {
    const dept = await prisma.department.upsert({
      where: { name_companyId: { name: d, companyId: company.id } },
      update: {},
      create: { name: d, companyId: company.id },
    });
    deptMap.set(d, dept.id);
  }

  // 5. Create Users (Admin, Team Leader, 5 Telecallers)
  const passwordHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.user.upsert({
    where: { phone: '9999999999' },
    update: {
      isPlatformAdmin: true,
      password: passwordHash,
      status: 'ACTIVE',
      roleId: rolesMap.get('SUPER_ADMIN')!,
    },
    create: {
      employeeId: 'EMP001',
      name: 'Aditya Sharma',
      email: 'aditya.admin@autodialpro.in',
      phone: '9999999999',
      password: passwordHash,
      roleId: rolesMap.get('SUPER_ADMIN')!,
      branchId: branchMap.get('DEL01'),
      companyId: company.id,
      dailyTarget: 150,
      isPlatformAdmin: true,
      status: 'ACTIVE',
    },
  });

  const teamLeader = await prisma.user.upsert({
    where: { phone: '9876500000' },
    update: {},
    create: {
      employeeId: 'TL001',
      name: 'Priya Mehta',
      email: 'priya.tl@autodialpro.in',
      phone: '9876500000',
      password: passwordHash,
      roleId: rolesMap.get('TEAM_LEADER')!,
      branchId: branchMap.get('DEL01'),
      departmentId: deptMap.get('Personal Loans'),
      reportingManagerId: admin.id,
      companyId: company.id,
      dailyTarget: 120,
    },
  });

  const telecallerData = [
    { employeeId: 'TC101', name: 'Rahul Verma', phone: '9876543211', email: 'rahul@autodialpro.in' },
    { employeeId: 'TC102', name: 'Amit Singh', phone: '9876543212', email: 'amit@autodialpro.in' },
    { employeeId: 'TC103', name: 'Neha Sharma', phone: '9876543213', email: 'neha@autodialpro.in' },
    { employeeId: 'TC104', name: 'Suresh Raina', phone: '9876543214', email: 'suresh@autodialpro.in' },
    { employeeId: 'TC105', name: 'Pooja Patel', phone: '9876543215', email: 'pooja@autodialpro.in' },
  ];

  const telecallerUsers: any[] = [];
  for (const tc of telecallerData) {
    const user = await prisma.user.upsert({
      where: { phone: tc.phone },
      update: {
        password: passwordHash,
        roleId: rolesMap.get('TELECALLER')!,
        status: 'ACTIVE',
      },
      create: {
        ...tc,
        password: passwordHash,
        roleId: rolesMap.get('TELECALLER')!,
        branchId: branchMap.get('DEL01'),
        departmentId: deptMap.get('Personal Loans'),
        reportingManagerId: teamLeader.id,
        companyId: company.id,
        dailyTarget: 100,
      },
    });
    telecallerUsers.push(user);
  }

  // 6. Create Campaigns (idempotent find-or-create)
  const campaign1Data = {
    name: 'Personal Loan Sourcing - Delhi NCR',
    description: 'Q4 Personal Loan lead campaign for salaried employees',
    type: 'Personal Loan',
    status: CampaignStatus.ACTIVE,
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-12-31'),
    dailyTarget: 500,
    maxAttemptsPerLead: 5,
    callingHoursStart: '09:00',
    callingHoursEnd: '23:00',
    companyId: company.id,
    createdById: admin.id,
  };
  let campaign1 = await prisma.campaign.findFirst({
    where: { name: campaign1Data.name, companyId: company.id },
  });
  if (!campaign1) {
    campaign1 = await prisma.campaign.create({ data: campaign1Data });
  } else {
    campaign1 = await prisma.campaign.update({
      where: { id: campaign1.id },
      data: {
        callingHoursStart: '09:00',
        callingHoursEnd: '23:00',
        status: CampaignStatus.ACTIVE,
      },
    });
  }

  const campaign2Data = {
    name: 'Overdue DPD 1-30 Collection',
    description: 'Payday and personal loan overdue payment follow-ups',
    type: 'Collection',
    status: CampaignStatus.ACTIVE,
    startDate: new Date('2026-11-05'),
    endDate: new Date('2026-11-30'),
    dailyTarget: 400,
    maxAttemptsPerLead: 6,
    callingHoursStart: '09:00',
    callingHoursEnd: '23:00',
    companyId: company.id,
    createdById: admin.id,
  };
  let campaign2 = await prisma.campaign.findFirst({
    where: { name: campaign2Data.name, companyId: company.id },
  });
  if (!campaign2) {
    campaign2 = await prisma.campaign.create({ data: campaign2Data });
  } else {
    campaign2 = await prisma.campaign.update({
      where: { id: campaign2.id },
      data: {
        callingHoursStart: '09:00',
        callingHoursEnd: '23:00',
        status: CampaignStatus.ACTIVE,
      },
    });
  }

  // 7. Create Dispositions
  const dispositions = [
    { name: 'Interested', category: 'CONNECTED', displayOrder: 1 },
    { name: 'Not Interested', category: 'CONNECTED', displayOrder: 2 },
    { name: 'Call Back', category: 'CONNECTED', displayOrder: 3 },
    { name: 'Loan Required', category: 'CONNECTED', displayOrder: 4 },
    { name: 'Documents Required', category: 'CONNECTED', displayOrder: 5 },
    { name: 'Application Submitted', category: 'CONNECTED', displayOrder: 6 },
    { name: 'Payment Promised', category: 'CONNECTED', displayOrder: 7 },
    { name: 'Wrong Number', category: 'CONNECTED', displayOrder: 8 },
    { name: 'Language Barrier', category: 'CONNECTED', displayOrder: 9 },
    { name: 'Already Taken Loan', category: 'CONNECTED', displayOrder: 10 },
    { name: 'Not Picked', category: 'UNANSWERED', displayOrder: 11 },
    { name: 'Busy', category: 'UNANSWERED', displayOrder: 12 },
    { name: 'Switched Off', category: 'UNANSWERED', displayOrder: 13 },
    { name: 'Not Reachable', category: 'UNANSWERED', displayOrder: 14 },
    { name: 'Call Declined', category: 'UNANSWERED', displayOrder: 15 },
    { name: 'Network Error', category: 'UNANSWERED', displayOrder: 16 },
    { name: 'DND / Do Not Contact', category: 'OTHER', displayOrder: 17 },
  ];

  for (const disp of dispositions) {
    await prisma.dispositionMaster.upsert({
      where: { name_companyId: { name: disp.name, companyId: company.id } },
      update: {},
      create: { ...disp, companyId: company.id },
    });
  }

  // 8. Create Message Templates
  const templates = [
    {
      name: 'LOAN_APPLICATION_01',
      type: MessageType.WHATSAPP,
      category: 'Loan Sourcing',
      content: 'Dear {customerName},\n\nThank you for your interest in our instant personal loan facility of ₹{amount}. Complete your KYC in 2 minutes using the link below:\n\n{link}\n\nRegards,\nAutoDial Support',
      variables: ['customerName', 'amount', 'link'],
      isApproved: true,
    },
    {
      name: 'CALLBACK_CONFIRMATION',
      type: MessageType.WHATSAPP,
      category: 'Follow-up',
      content: 'Dear {customerName}, as requested, our representative will call you back at {time}. Feel free to reply here if you have any questions.',
      variables: ['customerName', 'time'],
      isApproved: true,
    },
    {
      name: 'PAYMENT_REMINDER_SMS',
      type: MessageType.SMS,
      category: 'Collections',
      content: 'Dear {customerName}, your loan EMI of Rs.{amount} is due on {dueDate}. Pay instantly: {link}. AutoDial Finance.',
      variables: ['customerName', 'amount', 'dueDate', 'link'],
      isApproved: true,
    },
    {
      name: 'DOCUMENTS_REQUIRED_WA',
      type: MessageType.WHATSAPP,
      category: 'Documentation',
      content: 'Hi {customerName}, to process your loan application #{loanId}, please share: 1) PAN Card, 2) Aadhaar, 3) 3 Months Bank Statement.',
      variables: ['customerName', 'loanId'],
      isApproved: true,
    },
  ];

  for (const t of templates) {
    await prisma.messageTemplate.upsert({
      where: { name_companyId: { name: t.name, companyId: company.id } },
      update: {},
      create: { ...t, companyId: company.id },
    });
  }

  // 9. Create 50 Sample Leads
  const indianNames = [
    'Ramesh Kumar', 'Suresh Sharma', 'Amit Verma', 'Vikas Gupta', 'Deepak Yadav',
    'Rajesh Mishra', 'Manoj Pandey', 'Sunil Joshi', 'Anil Saxena', 'Karan Mehra',
    'Sandeep Tiwari', 'Arun Reddy', 'Gaurav Dubey', 'Nitin Chauhan', 'Alok Jain',
    'Manish Kapoor', 'Rohit Aggarwal', 'Dharmendra Singhania', 'Mukesh Bhatt', 'Santosh Pal',
    'Pooja Nair', 'Kavita Iyer', 'Ananya Sen', 'Meera Rao', 'Divya Menon',
    'Swati Deshmukh', 'Shalini Mathur', 'Sneha Kulkarni', 'Preeti Nambiar', 'Bhavna Chawla',
    'Harish Pillai', 'Tarun Goswami', 'Bipin Chandra', 'Prashant Nanda', 'Ajay Rawat',
    'Sanjay Kaushik', 'Naveen Grover', 'Pankaj Sethi', 'Mahesh Hegde', 'Hemant Rathi',
    'Ashok Goel', 'Satish Bhatia', 'Yogesh Somani', 'Vinod Singhal', 'Dinesh Soni',
    'Gopal Lodha', 'Rajat Bajaj', 'Kunal Lamba', 'Vijay Thukral', 'Suraj Chopra'
  ];

  const cities = ['Delhi', 'Noida', 'Gurugram', 'Mumbai', 'Bangalore', 'Pune', 'Hyderabad', 'Jaipur', 'Ahmedabad', 'Lucknow'];

  for (let i = 0; i < 50; i++) {
    const assignedUser = telecallerUsers[i % telecallerUsers.length];
    const mobile = `9811${(100000 + i).toString()}`;
    const amount = 25000 + (i % 8) * 15000;
    const city = cities[i % cities.length];

    // Prefer dialable statuses so Start Calling has a queue for every telecaller
    const dialStatus =
      i % 5 === 0
        ? LeadStatus.ASSIGNED
        : i < 35
          ? LeadStatus.NEW
          : LeadStatus.CALL_BACK;

    await prisma.lead.upsert({
      where: { id: `lead-demo-${i + 1}` },
      update: {
        assignedToId: assignedUser.id,
        campaignId: i < 30 ? campaign1.id : campaign2.id,
        status: dialStatus,
        totalAttempts: 0,
        isBlacklisted: false,
        nextFollowUpAt: dialStatus === LeadStatus.CALL_BACK ? new Date() : null,
      },
      create: {
        id: `lead-demo-${i + 1}`,
        customerName: indianNames[i],
        mobileNumber: mobile,
        city,
        state: 'India',
        loanAmount: amount,
        outstandingAmount: amount,
        loanId: `LN${20261100 + i}`,
        employer: i % 2 === 0 ? 'Private Ltd' : 'MNC Tech',
        product: i < 30 ? 'Personal Loan' : 'Payday Loan',
        source: i % 3 === 0 ? LeadSource.EXCEL_UPLOAD : LeadSource.WEBSITE,
        status: dialStatus,
        priority: i % 4 === 0 ? LeadPriority.HIGH : LeadPriority.MEDIUM,
        assignedToId: assignedUser.id,
        campaignId: i < 30 ? campaign1.id : campaign2.id,
        companyId: company.id,
        totalAttempts: 0,
        connectedCalls: 0,
        nextFollowUpAt: dialStatus === LeadStatus.CALL_BACK ? new Date() : null,
      },
    });
  }

  // 10. Calling rules — quiet hours late night only (demo); update if exists
  const existingRule = await prisma.callingRule.findFirst({
    where: { companyId: company.id, name: 'Standard RBI/TRAI Telecom Rules' },
  });
  if (!existingRule) {
    await prisma.callingRule.create({
      data: {
        name: 'Standard RBI/TRAI Telecom Rules',
        minGapBetweenCalls: 0,
        maxRetriesPerDay: 3,
        maxTotalRetries: 6,
        restrictedHoursStart: '00:00',
        restrictedHoursEnd: '06:00',
        waitTimeBetweenCalls: 5,
        companyId: company.id,
        isActive: true,
      },
    });
  } else {
    await prisma.callingRule.update({
      where: { id: existingRule.id },
      data: {
        minGapBetweenCalls: 0,
        restrictedHoursStart: '00:00',
        restrictedHoursEnd: '06:00',
        isActive: true,
      },
    });
  }

  console.log('Seeding completed successfully!');
  console.log('Admin (web): phone 9999999999 / password admin123 / company ADEMO');
  console.log('Telecaller (Android): phone 9876543211 / password admin123 / company ADEMO');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

