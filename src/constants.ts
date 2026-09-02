export const SOURCES = [
  '微信',
  '官网表单',
  '电话',
  '邮件',
  '展会',
  '抖音广告',
  'Excel导入',
  '企微',
  '老客户转介绍',
  '模拟抓取',
  '手动录入',
];

export const LEAD_STATUS = [
  { value: 'new', label: '新线索', color: 'blue' },
  { value: 'following', label: '跟进中', color: 'gold' },
  { value: 'converted', label: '已转客户', color: 'green' },
  { value: 'invalid', label: '无效', color: 'red' },
];

export const CUSTOMER_TABS = [
  { key: 'mine', label: '我的客户' },
  { key: 'public', label: '公海池' },
  { key: 'recycle', label: '回收站' },
];

export const OPPORTUNITY_STAGES = [
  { key: 'contact', label: '初步接触', color: '#1677ff', progress: 15 },
  { key: 'quote', label: '报价', color: '#13c2c2', progress: 40 },
  { key: 'negotiation', label: '谈判', color: '#fa8c16', progress: 70 },
  { key: 'closed_won', label: '成交', color: '#52c41a', progress: 100 },
  { key: 'closed_lost', label: '失败', color: '#f5222d', progress: 0 },
];

export const ACTIVITY_TYPES = [
  { key: 'note', label: '跟进日志', icon: 'edit' },
  { key: 'call', label: '电话', icon: 'phone' },
  { key: 'email', label: '邮件', icon: 'mail' },
  { key: 'social', label: '社媒', icon: 'message' },
  { key: 'quote', label: '报价', icon: 'money' },
];

export const TASK_TYPES = [
  { key: 'outreach', label: '拓客任务' },
  { key: 'todo', label: '待办事项' },
  { key: 'daily', label: '日报计划' },
];

export const TAG_COLORS = [
  'blue',
  'cyan',
  'gold',
  'green',
  'magenta',
  'orange',
  'purple',
  'red',
  'volcano',
  'geekblue',
];

export const ROLE_LABEL = {
  admin: '管理员',
  manager: '销售主管',
  sales: '销售',
};
