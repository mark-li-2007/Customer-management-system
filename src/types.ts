export type Role = 'admin' | 'manager' | 'sales';

export interface User {
  id: string;
  name: string;
  role: Role;
  color: string;
}

export interface Lead {
  id: string;
  company_name: string;
  contact_name: string;
  country: string;
  industry: string;
  phone: string;
  email: string;
  source: string;
  tags: string[];
  status: 'new' | 'following' | 'converted' | 'invalid';
  owner_id: string | null;
  duplicate_of: string | null;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface Customer {
  id: string;
  company_name: string;
  industry: string;
  country: string;
  source: string;
  owner_id: string | null;
  status: 'active' | 'public';
  locked_until: string | null;
  last_followed_at: string | null;
  follow_count: number;
  lead_id: string | null;
  contact_name: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  description: string;
  product_interest: string;
  budget: number | null;
  intent_level: string;
  next_follow_at: string | null;
  source_text: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface Contact {
  id: string;
  customer_id: string;
  name: string;
  position: string;
  phone: string;
  email: string;
  wechat: string;
  is_primary: number;
  created_at: string;
}

export type ActivityType = 'note' | 'email' | 'social' | 'call' | 'quote' | 'system';

export interface Activity {
  id: string;
  customer_id: string | null;
  lead_id: string | null;
  type: ActivityType;
  title: string;
  content: string;
  source_text: string | null;
  amount: number | null;
  occurred_at: string;
  created_by: string;
  created_at: string;
}

export interface Opportunity {
  id: string;
  customer_id: string;
  title: string;
  product: string;
  budget: number | null;
  stage: 'contact' | 'quote' | 'negotiation' | 'closed_won' | 'closed_lost';
  progress: number;
  expected_close_date: string | null;
  owner_id: string | null;
  contact_id: string | null;
  note: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  type: 'outreach' | 'todo' | 'daily';
  priority: 'high' | 'medium' | 'low';
  due_date: string | null;
  due_time: string | null;
  status: 'pending' | 'done';
  related_type: string | null;
  related_id: string | null;
  note: string;
  created_at: string;
  completed_at: string | null;
}

export interface DailyReport {
  id: string;
  user_id: string;
  report_date: string;
  content: string;
  plan: string;
  blockers: string;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  recycleDays: number;
  lockDays: number;
}

export interface CustomerCard {
  customer: Customer;
  contacts: Contact[];
  activities: Activity[];
  opportunities: Opportunity[];
  users: User[];
}

export interface DashboardData {
  leadCounts: Record<string, number>;
  customerCounts: { active: number; public: number };
  opportunityCounts: Record<string, number>;
  dueCustomers: Array<{
    id: string;
    company_name: string;
    deadline: string;
    last_followed_at: string;
  }>;
  tasks: Array<Task & { overdue: number }>;
  opportunitiesDue: Opportunity[];
  opportunitiesUpcoming: Opportunity[];
  settings: Settings;
}

export interface SimulatorResult {
  kind: 'lead' | 'email' | 'chat';
  message: string;
}
