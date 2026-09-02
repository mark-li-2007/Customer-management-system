import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(currentDir, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(join(dataDir, 'crm.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    color TEXT,
    active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    contact_name TEXT,
    country TEXT DEFAULT '',
    industry TEXT DEFAULT '',
    phone TEXT,
    email TEXT,
    source TEXT,
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'new',
    owner_id TEXT,
    duplicate_of TEXT,
    note TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    deleted_by TEXT
  );

  CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    industry TEXT,
    country TEXT DEFAULT '',
    source TEXT,
    owner_id TEXT,
    status TEXT DEFAULT 'active',
    locked_until TEXT,
    last_followed_at TEXT,
    follow_count INTEGER DEFAULT 0,
    lead_id TEXT,
    contact_name TEXT,
    phone TEXT,
    email TEXT,
    website TEXT,
    address TEXT,
    description TEXT,
    product_interest TEXT DEFAULT '',
    budget REAL,
    intent_level TEXT DEFAULT '',
    next_follow_at TEXT,
    source_text TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT,
    deleted_by TEXT
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position TEXT,
    phone TEXT,
    email TEXT,
    wechat TEXT,
    is_primary INTEGER DEFAULT 0,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    lead_id TEXT,
    type TEXT NOT NULL,
    title TEXT,
    content TEXT,
    source_text TEXT,
    amount REAL,
    occurred_at TEXT,
    created_by TEXT,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    title TEXT NOT NULL,
    product TEXT,
    budget REAL,
    stage TEXT DEFAULT 'contact',
    progress INTEGER DEFAULT 0,
    expected_close_date TEXT,
    owner_id TEXT,
    contact_id TEXT,
    note TEXT,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    due_date TEXT,
    due_time TEXT,
    status TEXT DEFAULT 'pending',
    related_type TEXT,
    related_id TEXT,
    note TEXT,
    created_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_reports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    report_date TEXT NOT NULL,
    content TEXT,
    plan TEXT,
    blockers TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS operation_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    created_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_deleted ON leads(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id);
  CREATE INDEX IF NOT EXISTS idx_customers_deleted ON customers(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_activities_customer ON activities(customer_id);
  CREATE INDEX IF NOT EXISTS idx_opportunities_customer ON opportunities(customer_id);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('leads', 'country', "TEXT DEFAULT ''");
ensureColumn('leads', 'industry', "TEXT DEFAULT ''");
ensureColumn('customers', 'country', "TEXT DEFAULT ''");
ensureColumn('customers', 'product_interest', "TEXT DEFAULT ''");
ensureColumn('customers', 'budget', 'REAL');
ensureColumn('customers', 'intent_level', "TEXT DEFAULT ''");
ensureColumn('customers', 'next_follow_at', 'TEXT');
ensureColumn('customers', 'source_text', 'TEXT');
ensureColumn('activities', 'source_text', 'TEXT');

const insert = (table, data) => {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  db.prepare(sql).run(...keys.map((key) => data[key]));
};

const pad = (value) => String(value).padStart(2, '0');
const formatLocal = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const nowIso = () => formatLocal(new Date());
const daysFromNow = (days, hour = 10, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, minute, 0, 0);
  return formatLocal(date);
};

export function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const users = [
    ['u_admin', '管理员', 'admin', '#722ed1'],
    ['u_manager', '销售主管', 'manager', '#13c2c2'],
    ['u_a', '王销售A', 'sales', '#1677ff'],
    ['u_b', '陈销售B', 'sales', '#fa8c16'],
  ];
  users.forEach(([id, name, role, color]) => insert('users', { id, name, role, color, active: 1 }));

  const defaults = [
    ['recycleDays', '30'],
    ['lockDays', '7'],
  ];
  defaults.forEach(([key, value]) => insert('settings', { key, value }));

  const leadRows = [
    ['l1', '华彩包装', '周敏', '13800138001', 'zhoumin@huacai.cn', '微信', '["制造业","包装"]', 'new', null],
    ['l2', '博远贸易', '刘洋', '13800138002', 'liuyang@boyuan.com', '官网表单', '["跨境","高意向"]', 'new', null],
    ['l3', '新锐科技', '陈晨', '13800138003', 'chenchen@xinrui.cn', '电话', '["软件"]', 'following', 'u_a'],
    ['l4', '绿洲食品', '徐佳', '13800138004', 'xujia@lvzhou.cn', '邮件', '["食品","连锁"]', 'following', 'u_b'],
    ['l5', '远达物流', '孙强', '13800138005', 'sunqiang@yuanda.cn', '展会', '["物流"]', 'new', null],
    ['l6', '蓝海家居', '赵敏', '13800138006', 'zhaomin@lanhai.cn', 'Excel导入', '["家居","复购"]', 'converted', 'u_a'],
    ['l7', '恒信咨询', '钱进', '13800138007', 'qianjin@hengxin.cn', '抖音广告', '["咨询","低意向"]', 'new', null],
    ['l8', '百川能源', '吴桐', '13800138008', 'wutong@baichuan.cn', '企微', '["能源","老客户推荐"]', 'new', null],
  ];
  leadRows.forEach(([id, company, contact, phone, email, source, tags, status, owner], index) => {
    insert('leads', {
      id,
      company_name: company,
      contact_name: contact,
      phone,
      email,
      source,
      tags,
      status,
      owner_id: owner,
      note: index % 2 === 0 ? '客户对交付周期比较关注。' : '',
      created_at: daysFromNow(-index - 1),
      updated_at: daysFromNow(-index - 1),
      deleted_at: null,
      deleted_by: null,
    });
  });

  const customerRows = [
    {
      id: 'c1',
      company_name: '晨光科技有限公司',
      industry: '智能制造',
      source: '电话',
      owner_id: 'u_a',
      locked_until: daysFromNow(5, 18),
      last_followed_at: daysFromNow(-1, 16),
      follow_count: 12,
      lead_id: 'l3',
      contact_name: '陈晨',
      phone: '13800138003',
      email: 'chenchen@xinrui.cn',
      website: 'www.chenguang-tech.cn',
      address: '深圳市南山区科技园',
      description: '主营工业检测设备，正在评估供应商。',
      created_at: daysFromNow(-48),
    },
    {
      id: 'c2',
      company_name: '远航电子',
      industry: '电子元器件',
      source: '展会',
      owner_id: 'u_b',
      locked_until: daysFromNow(3, 18),
      last_followed_at: daysFromNow(-2, 11),
      follow_count: 8,
      lead_id: 'l5',
      contact_name: '孙强',
      phone: '13800138005',
      email: 'sunqiang@yuanda.cn',
      website: 'www.yuanhang-elec.cn',
      address: '东莞市松山湖',
      description: 'Q4 有批量采购计划。',
      created_at: daysFromNow(-35),
    },
    {
      id: 'c3',
      company_name: '蓝天贸易',
      industry: '外贸',
      source: '官网表单',
      owner_id: null,
      locked_until: null,
      last_followed_at: daysFromNow(-45, 9),
      follow_count: 4,
      lead_id: 'l2',
      contact_name: '刘洋',
      phone: '13800138002',
      email: 'liuyang@boyuan.com',
      website: 'www.bluesky-trade.com',
      address: '上海市浦东新区',
      description: '进入公海，等待重新认领。',
      created_at: daysFromNow(-80),
    },
    {
      id: 'c4',
      company_name: '宏达机械',
      industry: '机械加工',
      source: '老客户转介绍',
      owner_id: 'u_a',
      locked_until: null,
      last_followed_at: daysFromNow(-3, 14),
      follow_count: 16,
      lead_id: null,
      contact_name: '李斌',
      phone: '13800138009',
      email: 'libin@hongda.cn',
      website: 'www.hongda-machine.cn',
      address: '佛山市顺德区',
      description: '历史成交老客户，有扩产需求。',
      created_at: daysFromNow(-210),
    },
    {
      id: 'c5',
      company_name: '星河网络',
      industry: '互联网',
      source: '企微',
      owner_id: 'u_b',
      locked_until: null,
      last_followed_at: daysFromNow(-6, 10),
      follow_count: 7,
      lead_id: 'l8',
      contact_name: '吴桐',
      phone: '13800138008',
      email: 'wutong@baichuan.cn',
      website: 'www.star-network.cn',
      address: '杭州市余杭区',
      description: '正在准备第二次报价。',
      created_at: daysFromNow(-60),
    },
    {
      id: 'c6',
      company_name: '云海餐饮',
      industry: '餐饮连锁',
      source: 'Excel导入',
      owner_id: null,
      locked_until: null,
      last_followed_at: daysFromNow(-12, 17),
      follow_count: 2,
      lead_id: 'l4',
      contact_name: '徐佳',
      phone: '13800138004',
      email: 'xujia@lvzhou.cn',
      website: 'www.yunhai-food.cn',
      address: '南京市建邺区',
      description: '新入公海客户。',
      created_at: daysFromNow(-40),
    },
  ];
  customerRows.forEach((customer) => {
    insert('customers', { ...customer, updated_at: customer.last_followed_at, deleted_at: null, deleted_by: null });
  });

  const contactRows = [
    ['ct1', 'c1', '陈晨', '采购经理', '13800138003', 'chenchen@xinrui.cn', 'cx_cc', 1],
    ['ct2', 'c1', '王总', '总经理', '13800138013', 'wang@chenguang.cn', 'cx_wz', 0],
    ['ct3', 'c2', '孙强', '供应链负责人', '13800138005', 'sunqiang@yuanda.cn', 'yh_sq', 1],
    ['ct4', 'c3', '刘洋', '外贸主管', '13800138002', 'liuyang@boyuan.com', 'lt_ly', 1],
    ['ct5', 'c4', '李斌', '设备部经理', '13800138009', 'libin@hongda.cn', 'hd_lb', 1],
    ['ct6', 'c5', '吴桐', '运营总监', '13800138008', 'wutong@baichuan.cn', 'xh_wt', 1],
    ['ct7', 'c6', '徐佳', '加盟负责人', '13800138004', 'xujia@lvzhou.cn', 'yh_xj', 1],
  ];
  contactRows.forEach(([id, customerId, name, position, phone, email, wechat, primary]) => {
    insert('contacts', { id, customer_id: customerId, name, position, phone, email, wechat, is_primary: primary, created_at: daysFromNow(-20) });
  });

  const activityRows = [
    ['a1', 'c1', 'note', '首次电话沟通', '客户关注 30 天交付周期，需要补充产品案例。', null, daysFromNow(-28), 'u_a'],
    ['a2', 'c1', 'quote', '发送第一轮报价', '已发送基础版报价，客户希望拆分为软硬件两项。', 68000, daysFromNow(-14), 'u_a'],
    ['a3', 'c1', 'email', '邮件回复技术问题', '陈经理确认本周组织内部评审。', null, daysFromNow(-6), 'u_a'],
    ['a4', 'c1', 'social', '微信跟进', '已同步项目周期表，约定下周二次演示。', null, daysFromNow(-1), 'u_a'],
    ['a5', 'c2', 'note', '展会现场建立联系', '客户对贴片机方案兴趣度高。', null, daysFromNow(-30), 'u_b'],
    ['a6', 'c2', 'quote', '第二轮报价', '按季度采购量给出阶梯价。', 96000, daysFromNow(-9), 'u_b'],
    ['a7', 'c2', 'call', '电话确认订单节奏', '预计月底前确认首批数量。', null, daysFromNow(-2), 'u_b'],
    ['a8', 'c3', 'email', '历史报价跟进', '客户表示预算未批复，暂停推进。', 42000, daysFromNow(-45), 'u_a'],
    ['a9', 'c4', 'call', '老客户回访', '反馈设备运行稳定，有新增产线计划。', null, daysFromNow(-8), 'u_a'],
    ['a10', 'c4', 'note', '整理扩产需求', '预计 Q4 采购 3 台数控设备。', null, daysFromNow(-3), 'u_a'],
    ['a11', 'c5', 'social', '企微沟通方案', '吴总要求补充售后 SLA。', null, daysFromNow(-6), 'u_b'],
    ['a12', 'c5', 'quote', '发送附加报价', '含 7x24 驻场服务报价。', 150000, daysFromNow(-2), 'u_b'],
  ];
  activityRows.forEach(([id, customerId, type, title, content, amount, occurredAt, user]) => {
    insert('activities', {
      id,
      customer_id: customerId,
      lead_id: null,
      type,
      title,
      content,
      amount,
      occurred_at: occurredAt,
      created_by: user,
      created_at: occurredAt,
    });
  });

  const opportunityRows = [
    ['o1', 'c1', '工业检测设备采购', '视觉检测系统', 680000, 'negotiation', 65, daysFromNow(8), 'u_a', 'ct1', '客户已进入内部评审'],
    ['o2', 'c2', '贴片机年度采购', 'SMT 产线', 960000, 'quote', 40, daysFromNow(-1), 'u_b', 'ct3', '等待商务审批'],
    ['o3', 'c3', '外贸报关系统', '报关软件', 120000, 'closed_lost', 0, daysFromNow(-30), 'u_a', 'ct4', '预算未批复'],
    ['o4', 'c4', '数控设备扩产', '数控机床', 1500000, 'contact', 15, daysFromNow(22), 'u_a', 'ct5', 'Q4 启动采购'],
    ['o5', 'c5', '网络运维服务', '运维托管', 150000, 'closed_won', 100, daysFromNow(-4), 'u_b', 'ct6', '已签年度合同'],
  ];
  opportunityRows.forEach(([id, customerId, title, product, budget, stage, progress, due, owner, contactId, note]) => {
    insert('opportunities', {
      id,
      customer_id: customerId,
      title,
      product,
      budget,
      stage,
      progress,
      expected_close_date: due,
      owner_id: owner,
      contact_id: contactId,
      note,
      created_at: daysFromNow(-15),
      updated_at: daysFromNow(-1),
      deleted_at: null,
    });
  });

  const taskRows = [
    ['t1', 'u_a', '跟进晨光科技技术评审', 'outreach', 'high', daysFromNow(0), '10:30', 'pending', 'customer', 'c1', '提前准备演示素材'],
    ['t2', 'u_b', '远航电子首批数量确认', 'outreach', 'high', daysFromNow(0), '16:00', 'pending', 'customer', 'c2', '电话确认'],
    ['t3', 'u_a', '整理宏达机械扩产需求', 'todo', 'medium', daysFromNow(1), null, 'pending', 'customer', 'c4', ''],
    ['t4', 'u_a', '发送商机报价', 'todo', 'medium', daysFromNow(2), null, 'pending', 'opportunity', 'o1', ''],
    ['t5', 'u_b', '周报数据统计', 'todo', 'low', daysFromNow(-1), null, 'done', null, null, ''],
    ['t6', 'u_b', '星河的客户维护回访', 'outreach', 'medium', daysFromNow(1), '14:00', 'pending', 'customer', 'c5', ''],
    ['t7', 'u_a', '填写今日日报', 'todo', 'medium', daysFromNow(0), null, 'done', null, null, ''],
    ['t8', 'u_b', '新增 5 条拓客任务', 'outreach', 'medium', daysFromNow(0), '09:30', 'pending', null, null, ''],
  ];
  taskRows.forEach(([id, userId, title, type, priority, dueDate, dueTime, status, relatedType, relatedId, note]) => {
    insert('tasks', {
      id,
      user_id: userId,
      title,
      type,
      priority,
      due_date: dueDate.slice(0, 10),
      due_time: dueTime,
      status,
      related_type: relatedType,
      related_id: relatedId,
      note,
      created_at: daysFromNow(-2),
      completed_at: status === 'done' ? daysFromNow(-1) : null,
    });
  });

  const reportRows = [
    ['r1', 'u_a', daysFromNow(-1, 18).slice(0, 10), '完成 5 条线索跟进，晨光科技进入技术评审阶段。', '推进报价并准备下周演示。', '客户预算仍在确认。'],
    ['r2', 'u_b', daysFromNow(-1, 18).slice(0, 10), '远航电子完成第二轮报价，星河网络已签年度合同。', '确认远航首批数量，继续拓展新线索。', ''],
  ];
  reportRows.forEach(([id, userId, date, content, plan, blockers]) => {
    insert('daily_reports', {
      id,
      user_id: userId,
      report_date: date,
      content,
      plan,
      blockers,
      created_at: daysFromNow(-1),
      updated_at: daysFromNow(-1),
    });
  });

  const logRows = [
    ['op1', 'u_admin', '初始化演示数据', 'system', 'all', '写入演示客户、线索与商机。', daysFromNow(-1)],
  ];
  logRows.forEach(([id, userId, action, type, targetId, detail, time]) => {
    insert('operation_logs', { id, user_id: userId, action, target_type: type, target_id: targetId, detail, created_at: time });
  });
}

seedIfEmpty();

export function nowIsoLocal() {
  return nowIso();
}

export function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    recycleDays: Number(settings.recycleDays ?? 30),
    lockDays: Number(settings.lockDays ?? 7),
  };
}
