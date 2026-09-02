import express from 'express';
import {
  createId,
  db,
  getSettings,
  nowIsoLocal,
} from './db.js';
import {
  addDaysIso,
  canClaimCustomer,
  canEditCustomer,
  followDeadline,
  groupDuplicateCandidates,
  shouldAutoRecycle,
} from './services/rules.js';
import {
  extractEmails,
  extractPhones,
  parseChatText,
  parseEmailText,
} from './services/parser.js';
import {
  checkDuplicateWithAI,
  extractLeadBatchWithAI,
  extractLeadWithAI,
  generateDailyReportWithAI,
  parseTaskWithAI,
  processCustomerChatWithAI,
} from './services/aiWorkflow.js';

const app = express();
app.use(express.json({ limit: '20mb' }));

const ok = (res, data) => res.json({ ok: true, data });
const fail = (res, status, message) => res.status(status).json({ ok: false, message });
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function currentUser(req) {
  const id = req.get('x-demo-user-id') || 'u_a';
  return db.prepare('SELECT id, name, role, color FROM users WHERE id = ? AND active = 1').get(id);
}

function canManage(user) {
  return user && ['admin', 'manager'].includes(user.role);
}

function addLog(user, action, targetType, targetId, detail) {
  db.prepare(
    'INSERT INTO operation_logs (id, user_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(createId('op'), user?.id ?? null, action, targetType, targetId, detail ?? '', nowIsoLocal());
}

function leadOut(row) {
  if (!row) return null;
  return { ...row, tags: JSON.parse(row.tags ?? '[]') };
}

function patchRow(table, id, data) {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const set = keys.map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`).run(...keys.map((key) => data[key]), id);
}

function visibleCustomersSql(user, scope) {
  if (scope === 'recycle') {
    return { sql: 'WHERE deleted_at IS NOT NULL', params: [] };
  }
  const base = 'WHERE deleted_at IS NULL';
  if (!canManage(user) && user?.role === 'sales') {
    if (scope === 'public') return { sql: `${base} AND owner_id IS NULL`, params: [] };
    return { sql: `${base} AND owner_id = ?`, params: [user.id] };
  }
  if (scope === 'public') return { sql: `${base} AND owner_id IS NULL`, params: [] };
  if (scope === 'mine' && user) return { sql: `${base} AND owner_id = ?`, params: [user.id] };
  return { sql: base, params: [] };
}

function findCustomer(id) {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function findLead(id) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

app.get('/api/health', (req, res) => ok(res, { status: 'up' }));

app.get('/api/me', (req, res) => {
  const user = currentUser(req);
  if (!user) return fail(res, 401, '演示用户不存在');
  ok(res, user);
});

app.get('/api/users', (req, res) => {
  ok(res, db.prepare('SELECT id, name, role, color FROM users WHERE active = 1 ORDER BY role, id').all());
});

app.get('/api/settings', (req, res) => ok(res, getSettings()));

app.put('/api/settings', (req, res) => {
  const user = currentUser(req);
  if (!canManage(user)) return fail(res, 403, '仅管理员和销售主管可修改全局设置');
  const recycleDays = Math.max(0, Number(req.body?.recycleDays ?? 30));
  const lockDays = Math.max(0, Number(req.body?.lockDays ?? 7));
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('recycleDays', String(recycleDays));
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('lockDays', String(lockDays));
  addLog(user, '更新设置', 'settings', 'global', `公海回收 ${recycleDays} 天，认领锁定 ${lockDays} 天`);
  ok(res, getSettings());
});

app.get('/api/dashboard', (req, res) => {
  const user = currentUser(req);
  const settings = getSettings();
  const leadCounts = Object.fromEntries(
    db.prepare('SELECT status, COUNT(*) AS count FROM leads WHERE deleted_at IS NULL GROUP BY status').all().map((row) => [row.status, row.count]),
  );
  const customerWhere = canManage(user)
    ? 'deleted_at IS NULL'
    : `deleted_at IS NULL AND (owner_id IS NULL OR owner_id = '${user.id}')`;
  const customers = db.prepare(`SELECT * FROM customers WHERE ${customerWhere}`).all();
  const customerCounts = {
    active: customers.filter((item) => item.owner_id && item.status === 'active').length,
    public: customers.filter((item) => !item.owner_id).length,
  };
  const opportunityRows = canManage(user)
    ? db.prepare('SELECT * FROM opportunities WHERE deleted_at IS NULL').all()
    : db.prepare('SELECT * FROM opportunities WHERE deleted_at IS NULL AND owner_id = ?').all(user.id);
  const opportunityCounts = {};
  opportunityRows.forEach((item) => {
    opportunityCounts[item.stage] = (opportunityCounts[item.stage] ?? 0) + 1;
  });

  const today = new Date().toISOString().slice(0, 10);
  const dueCustomers = customers
    .filter((item) => item.owner_id)
    .map((item) => ({
      id: item.id,
      company_name: item.company_name,
      deadline: followDeadline(item, settings.recycleDays),
      last_followed_at: item.last_followed_at,
    }))
    .filter((item) => item.deadline && item.deadline.slice(0, 10) <= today)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  const tasks = (canManage(user)
    ? db.prepare('SELECT * FROM tasks WHERE status = ? ORDER BY due_date, due_time').all('pending')
    : db.prepare('SELECT * FROM tasks WHERE user_id = ? AND status = ? ORDER BY due_date, due_time').all(user.id, 'pending'))
    .map((task) => ({
      ...task,
      overdue: task.due_date && task.due_date < today ? 1 : 0,
    }));

  const oppDue = opportunityRows
    .filter((item) => item.stage !== 'closed_won' && item.stage !== 'closed_lost' && item.expected_close_date)
    .filter((item) => item.expected_close_date.slice(0, 10) <= today)
    .sort((a, b) => a.expected_close_date.localeCompare(b.expected_close_date));
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const sevenDaysText = sevenDaysLater.toISOString().slice(0, 10);
  const oppUpcoming = opportunityRows
    .filter((item) => item.stage !== 'closed_won' && item.stage !== 'closed_lost' && item.expected_close_date)
    .filter((item) => {
      const date = item.expected_close_date.slice(0, 10);
      return date > today && date <= sevenDaysText;
    })
    .sort((a, b) => a.expected_close_date.localeCompare(b.expected_close_date));

  ok(res, {
    leadCounts,
    customerCounts,
    opportunityCounts,
    dueCustomers: dueCustomers.slice(0, 8),
    tasks: tasks.slice(0, 8),
    opportunitiesDue: oppDue.slice(0, 6),
    opportunitiesUpcoming: oppUpcoming.slice(0, 6),
    settings,
  });
});

app.get('/api/leads', (req, res) => {
  const user = currentUser(req);
  const params = [];
  const conditions = [];
  if (req.query.includeDeleted === '1') conditions.push('deleted_at IS NOT NULL');
  else conditions.push('deleted_at IS NULL');
  if (!canManage(user) && user?.role === 'sales') {
    conditions.push('(owner_id IS NULL OR owner_id = ?)');
    params.push(user.id);
  }
  if (req.query.source) {
    conditions.push('source = ?');
    params.push(req.query.source);
  }
  if (req.query.status) {
    conditions.push('status = ?');
    params.push(req.query.status);
  }
  if (req.query.q) {
    conditions.push('(company_name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q, q);
  }
  const rows = db
    .prepare(`SELECT * FROM leads WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params);
  ok(res, rows.map(leadOut));
});

app.post('/api/leads', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  if (!body.company_name) return fail(res, 400, '公司名称不能为空');
  const id = createId('lead');
  const now = nowIsoLocal();
  const row = {
    id,
    company_name: body.company_name,
    contact_name: body.contact_name ?? '',
    country: body.country ?? '',
    industry: body.industry ?? '',
    phone: body.phone ?? '',
    email: body.email ?? '',
    source: body.source ?? '手动录入',
    tags: JSON.stringify(body.tags ?? []),
    status: 'new',
    owner_id: body.owner_id ?? null,
    duplicate_of: null,
    note: body.note ?? '',
    created_at: now,
    updated_at: now,
    deleted_at: null,
    deleted_by: null,
  };
  db.prepare(
    `INSERT INTO leads (id, company_name, contact_name, country, industry, phone, email, source, tags, status, owner_id, duplicate_of, note, created_at, updated_at, deleted_at, deleted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(...Object.values(row));
  const duplicateRows = db
    .prepare(
      `SELECT * FROM leads WHERE deleted_at IS NULL AND id != ? AND (phone = ? OR email = ? OR lower(company_name) = lower(?))`,
    )
    .all(id, body.phone ?? '', body.email ?? '', body.company_name);
  addLog(user, '新建线索', 'lead', id, body.company_name);
  ok(res, { lead: leadOut(row), duplicates: duplicateRows.map(leadOut) });
});

app.patch('/api/leads/:id', (req, res) => {
  const user = currentUser(req);
  const lead = findLead(req.params.id);
  if (!lead || lead.deleted_at) return fail(res, 404, '线索不存在');
  const allowed = ['company_name', 'contact_name', 'country', 'industry', 'phone', 'email', 'source', 'tags', 'status', 'note', 'owner_id', 'duplicate_of'];
  const data = {};
  allowed.forEach((key) => {
    if (key in req.body) data[key] = key === 'tags' ? JSON.stringify(req.body[key]) : req.body[key];
  });
  data.updated_at = nowIsoLocal();
  patchRow('leads', lead.id, data);
  addLog(user, '更新线索', 'lead', lead.id, data.company_name ?? lead.company_name);
  ok(res, leadOut(db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)));
});

app.post('/api/leads/batch', (req, res) => {
  const user = currentUser(req);
  const { ids = [], action, owner_id } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, '请选择线索');
  if (!['assign', 'delete', 'restore'].includes(action)) return fail(res, 400, '不支持的操作');
  const now = nowIsoLocal();
  db.exec('BEGIN');
  try {
    ids.forEach((id) => {
      const lead = findLead(id);
      if (!lead) return;
      if (action === 'assign') {
        db.prepare('UPDATE leads SET owner_id = ?, status = ?, updated_at = ? WHERE id = ?').run(owner_id ?? user.id, 'following', now, id);
      } else if (action === 'delete') {
        db.prepare('UPDATE leads SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?').run(now, user.id, now, id);
      } else {
        db.prepare('UPDATE leads SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?').run(now, id);
      }
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return fail(res, 500, error.message);
  }
  addLog(user, `批量${action}线索`, 'lead', ids.join(','), `${ids.length} 条`);
  ok(res, { count: ids.length });
});

app.post('/api/leads/import', (req, res) => {
  const user = currentUser(req);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!rows.length) return fail(res, 400, '没有可导入的数据');
  const now = nowIsoLocal();
  const result = { imported: 0, duplicates: 0, failed: 0, messages: [] };
  db.exec('BEGIN');
  try {
    rows.forEach((item, index) => {
      const companyName = String(item.company_name ?? '').trim();
      const phone = String(item.phone ?? '').trim();
      const email = String(item.email ?? '').trim();
      if (!companyName) {
        result.failed += 1;
        result.messages.push(`第 ${index + 2} 行缺少公司名称`);
        return;
      }
      const dup = db
        .prepare('SELECT id FROM leads WHERE deleted_at IS NULL AND (phone = ? OR email = ? OR lower(company_name) = lower(?)) LIMIT 1')
        .get(phone, email, companyName);
      if (dup) {
        result.duplicates += 1;
        return;
      }
      const id = createId('lead');
      const row = {
        id,
        company_name: companyName,
        contact_name: item.contact_name ?? '',
        country: item.country ?? '',
        industry: item.industry ?? '',
        phone,
        email,
        source: item.source ?? 'Excel导入',
        tags: JSON.stringify(String(item.tags ?? '').split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)),
        status: 'new',
        owner_id: null,
        duplicate_of: null,
        note: item.note ?? '',
        created_at: now,
        updated_at: now,
        deleted_at: null,
        deleted_by: null,
      };
      db.prepare(
        `INSERT INTO leads (id, company_name, contact_name, country, industry, phone, email, source, tags, status, owner_id, duplicate_of, note, created_at, updated_at, deleted_at, deleted_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(...Object.values(row));
      result.imported += 1;
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return fail(res, 500, error.message);
  }
  addLog(user, '导入线索', 'lead', 'excel', `导入 ${result.imported} 条，重复 ${result.duplicates} 条`);
  ok(res, result);
});

app.get('/api/leads/duplicates', (req, res) => {
  const rows = db.prepare('SELECT id, company_name, contact_name, phone, email FROM leads WHERE deleted_at IS NULL').all();
  ok(res, groupDuplicateCandidates(rows));
});

app.post('/api/leads/:id/convert', (req, res) => {
  const user = currentUser(req);
  const lead = findLead(req.params.id);
  if (!lead || lead.deleted_at) return fail(res, 404, '线索不存在');
  const sameCompany = db
    .prepare('SELECT id, company_name FROM customers WHERE deleted_at IS NULL AND lower(company_name) = lower(?)')
    .get(lead.company_name);
  if (sameCompany) return fail(res, 409, `该线索对应客户 ${sameCompany.company_name} 已存在`);
  const settings = getSettings();
  const now = nowIsoLocal();
  const customerId = createId('cust');
  const ownerId = lead.owner_id ?? user.id;
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO customers (id, company_name, industry, country, source, owner_id, status, locked_until, last_followed_at, follow_count, lead_id, contact_name, phone, email, website, address, description, created_at, updated_at, deleted_at, deleted_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      customerId,
      lead.company_name,
      req.body.industry ?? '',
      lead.country ?? '',
      lead.source ?? '手动',
      ownerId,
      addDaysIso(settings.lockDays),
      now,
      lead.id,
      lead.contact_name ?? '',
      lead.phone ?? '',
      lead.email ?? '',
      req.body.website ?? '',
      req.body.address ?? '',
      req.body.description ?? '',
      now,
      now,
    );
    if (lead.contact_name) {
      db.prepare(
        'INSERT INTO contacts (id, customer_id, name, position, phone, email, wechat, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
      ).run(createId('ct'), customerId, lead.contact_name, req.body.position ?? '', lead.phone ?? '', lead.email ?? '', '', now);
    }
    db.prepare(
      'INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)',
    ).run(createId('act'), customerId, lead.id, 'system', '线索转为客户', '由线索池完成客户建档。', now, user.id, now);
    db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run('converted', now, lead.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return fail(res, 500, error.message);
  }
  addLog(user, '线索转客户', 'customer', customerId, lead.company_name);
  ok(res, { customerId });
});

app.get('/api/customers', (req, res) => {
  const user = currentUser(req);
  const scope = req.query.scope || (canManage(user) ? 'all' : 'mine');
  const { sql, params } = visibleCustomersSql(user, scope);
  const q = req.query.q;
  if (q) {
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    ok(
      res,
      db.prepare(`SELECT * FROM customers ${sql} ${sql.includes('WHERE') ? 'AND' : 'WHERE'} (company_name LIKE ? OR contact_name LIKE ? OR phone LIKE ?) ORDER BY created_at DESC`).all(...params),
    );
    return;
  }
  ok(res, db.prepare(`SELECT * FROM customers ${sql} ORDER BY created_at DESC`).all(...params));
});

app.get('/api/customers/:id/card', (req, res) => {
  const customer = findCustomer(req.params.id);
  if (!customer) return fail(res, 404, '客户不存在');
  const contacts = db.prepare('SELECT * FROM contacts WHERE customer_id = ? ORDER BY is_primary DESC, created_at').all(customer.id);
  const activities = db.prepare('SELECT * FROM activities WHERE customer_id = ? ORDER BY occurred_at DESC, created_at DESC').all(customer.id);
  const opportunities = db.prepare('SELECT * FROM opportunities WHERE customer_id = ? AND deleted_at IS NULL ORDER BY expected_close_date').all(customer.id);
  const users = db.prepare('SELECT id, name, role, color FROM users').all();
  ok(res, { customer, contacts, activities, opportunities, users });
});

app.post('/api/customers/:id/claim', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canClaimCustomer(customer, user)) return fail(res, 409, '该客户已有负责人或当前不可认领');
  const settings = getSettings();
  const now = nowIsoLocal();
  db.prepare(
    'UPDATE customers SET owner_id = ?, status = ?, locked_until = ?, last_followed_at = COALESCE(last_followed_at, ?), updated_at = ? WHERE id = ?',
  ).run(user.id, 'active', addDaysIso(settings.lockDays), now, now, customer.id);
  addLog(user, '认领客户', 'customer', customer.id, `${customer.company_name}，锁定 ${settings.lockDays} 天`);
  ok(res, findCustomer(customer.id));
});

app.post('/api/customers/:id/follow', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canEditCustomer(customer, user)) return fail(res, 403, '仅客户负责人或管理员可录入跟进');
  const body = req.body ?? {};
  if (!body.content && !body.title) return fail(res, 400, '请填写跟进内容');
  const settings = getSettings();
  const occurredAt = body.occurred_at || nowIsoLocal();
  const activityId = createId('act');
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      activityId,
      customer.id,
      body.type ?? 'note',
      body.title ?? (body.type === 'quote' ? '报价记录' : '跟进日志'),
      body.content ?? '',
      Number(body.amount) || null,
      occurredAt,
      user.id,
      nowIsoLocal(),
    );
    db.prepare(
      'UPDATE customers SET last_followed_at = ?, follow_count = follow_count + 1, locked_until = ?, updated_at = ? WHERE id = ?',
    ).run(occurredAt, addDaysIso(settings.lockDays), nowIsoLocal(), customer.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    return fail(res, 500, error.message);
  }
  addLog(user, '录入跟进', 'customer', customer.id, body.title ?? '跟进记录');
  ok(res, {
    activity: db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId),
    customer: findCustomer(customer.id),
  });
});

app.post('/api/customers/:id/transfer', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  const targetId = req.body?.owner_id;
  if (!targetId) return fail(res, 400, '请选择接收销售');
  if (!canManage(user) && customer.owner_id !== user.id) return fail(res, 403, '无权限移交该客户');
  const target = db.prepare('SELECT id, name FROM users WHERE id = ? AND role = ?').get(targetId, 'sales');
  if (!target) return fail(res, 400, '接收人必须是销售角色');
  const settings = getSettings();
  const now = nowIsoLocal();
  db.prepare(
    'UPDATE customers SET owner_id = ?, status = ?, locked_until = ?, updated_at = ? WHERE id = ?',
  ).run(targetId, 'active', addDaysIso(settings.lockDays), now, customer.id);
  addLog(user, '移交客户', 'customer', customer.id, `${customer.company_name} 移交给 ${target.name}`);
  ok(res, findCustomer(customer.id));
});

app.post('/api/customers/:id/recycle', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canManage(user) && customer.owner_id !== user.id) return fail(res, 403, '无权限回收该客户');
  const now = nowIsoLocal();
  db.prepare(
    'UPDATE customers SET owner_id = NULL, status = ?, locked_until = NULL, updated_at = ? WHERE id = ?',
  ).run('public', now, customer.id);
  addLog(user, '回收至公海', 'customer', customer.id, customer.company_name);
  ok(res, findCustomer(customer.id));
});

app.post('/api/customers/:id/restore', (req, res) => {
  const user = currentUser(req);
  if (!canManage(user)) return fail(res, 403, '仅管理员可恢复已删除客户');
  db.prepare('UPDATE customers SET deleted_at = NULL, deleted_by = NULL, status = ?, updated_at = ? WHERE id = ?').run('public', nowIsoLocal(), req.params.id);
  addLog(user, '恢复客户', 'customer', req.params.id, '从回收站恢复');
  ok(res, findCustomer(req.params.id));
});

app.delete('/api/customers/:id', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canManage(user) && customer.owner_id !== user.id) return fail(res, 403, '无权限删除该客户');
  db.prepare('UPDATE customers SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?').run(nowIsoLocal(), user.id, nowIsoLocal(), customer.id);
  addLog(user, '删除客户', 'customer', customer.id, customer.company_name);
  ok(res, { id: customer.id });
});

app.post('/api/customers', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  if (!body.company_name) return fail(res, 400, '公司名称不能为空');
  const now = nowIsoLocal();
  const id = createId('cust');
  const ownerId = body.owner_id || user.id;
  const settings = getSettings();
  db.prepare(
    `INSERT INTO customers (id, company_name, industry, country, product_interest, budget, intent_level, source, owner_id, status, locked_until, last_followed_at, follow_count, lead_id, contact_name, phone, email, website, address, description, created_at, updated_at, deleted_at, deleted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    id,
    body.company_name,
    body.industry ?? '',
    body.country ?? '',
    body.product_interest ?? '',
    typeof body.budget === 'number' ? body.budget : null,
    body.intent_level ?? '',
    body.source ?? '手动建档',
    ownerId,
    addDaysIso(settings.lockDays),
    now,
    body.contact_name ?? '',
    body.phone ?? '',
    body.email ?? '',
    body.website ?? '',
    body.address ?? '',
    body.description ?? '',
    now,
    now,
  );
  if (body.contact_name) {
    db.prepare(
      'INSERT INTO contacts (id, customer_id, name, position, phone, email, wechat, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
    ).run(createId('ct'), id, body.contact_name, '', body.phone ?? '', body.email ?? '', '', now);
  }
  addLog(user, '新建客户', 'customer', id, body.company_name);
  ok(res, findCustomer(id));
});

app.patch('/api/customers/:id', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canEditCustomer(customer, user)) return fail(res, 403, '无权修改客户档案');
  const allowed = [
    'company_name',
    'industry',
    'country',
    'product_interest',
    'budget',
    'intent_level',
    'next_follow_at',
    'source',
    'contact_name',
    'phone',
    'email',
    'website',
    'address',
    'description',
    'locked_until',
  ];
  const data = {};
  allowed.forEach((key) => {
    if (key in req.body) data[key] = req.body[key];
  });
  data.updated_at = nowIsoLocal();
  patchRow('customers', customer.id, data);
  addLog(user, '更新客户档案', 'customer', customer.id, customer.company_name);
  ok(res, findCustomer(customer.id));
});

app.post('/api/customers/:id/contacts', (req, res) => {
  const user = currentUser(req);
  const customer = findCustomer(req.params.id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canEditCustomer(customer, user)) return fail(res, 403, '无权新增联系人');
  const body = req.body ?? {};
  if (!body.name) return fail(res, 400, '联系人姓名不能为空');
  const id = createId('ct');
  db.prepare(
    'INSERT INTO contacts (id, customer_id, name, position, phone, email, wechat, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, customer.id, body.name, body.position ?? '', body.phone ?? '', body.email ?? '', body.wechat ?? '', body.is_primary ? 1 : 0, nowIsoLocal());
  addLog(user, '新增联系人', 'customer', customer.id, body.name);
  ok(res, db.prepare('SELECT * FROM contacts WHERE id = ?').get(id));
});

app.get('/api/opportunities', (req, res) => {
  const user = currentUser(req);
  const rows = canManage(user)
    ? db.prepare('SELECT * FROM opportunities WHERE deleted_at IS NULL ORDER BY updated_at DESC').all()
    : db.prepare('SELECT * FROM opportunities WHERE deleted_at IS NULL AND owner_id = ? ORDER BY updated_at DESC').all(user.id);
  ok(res, rows);
});

app.post('/api/opportunities', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  if (!body.customer_id || !body.title) return fail(res, 400, '客户和商机名称不能为空');
  const customer = findCustomer(body.customer_id);
  if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
  if (!canEditCustomer(customer, user)) return fail(res, 403, '无权为该客户新建商机');
  const now = nowIsoLocal();
  const id = createId('opp');
  const stage = body.stage ?? 'contact';
  db.prepare(
    `INSERT INTO opportunities (id, customer_id, title, product, budget, stage, progress, expected_close_date, owner_id, contact_id, note, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    body.customer_id,
    body.title,
    body.product ?? '',
    Number(body.budget) || null,
    stage,
    body.progress ?? 15,
    body.expected_close_date || null,
    body.owner_id || customer.owner_id || user.id,
    body.contact_id || null,
    body.note ?? '',
    now,
    now,
  );
  addLog(user, '新建商机', 'opportunity', id, body.title);
  ok(res, db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id));
});

app.patch('/api/opportunities/:id', (req, res) => {
  const user = currentUser(req);
  const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opportunity || opportunity.deleted_at) return fail(res, 404, '商机不存在');
  const customer = findCustomer(opportunity.customer_id);
  if (!customer || !canEditCustomer(customer, user)) return fail(res, 403, '无权限修改该商机');
  const allowed = ['title', 'product', 'budget', 'stage', 'progress', 'expected_close_date', 'owner_id', 'contact_id', 'note'];
  const data = {};
  allowed.forEach((key) => {
    if (key in req.body) data[key] = req.body[key];
  });
  data.updated_at = nowIsoLocal();
  patchRow('opportunities', opportunity.id, data);
  addLog(user, '更新商机', 'opportunity', opportunity.id, data.title ?? opportunity.title);
  ok(res, db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opportunity.id));
});

app.delete('/api/opportunities/:id', (req, res) => {
  const user = currentUser(req);
  const opportunity = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!opportunity || opportunity.deleted_at) return fail(res, 404, '商机不存在');
  const customer = findCustomer(opportunity.customer_id);
  if (!customer || !canEditCustomer(customer, user)) return fail(res, 403, '无权限删除该商机');
  db.prepare('UPDATE opportunities SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIsoLocal(), nowIsoLocal(), opportunity.id);
  addLog(user, '删除商机', 'opportunity', opportunity.id, opportunity.title);
  ok(res, { id: opportunity.id });
});

app.get('/api/tasks', (req, res) => {
  const user = currentUser(req);
  const date = req.query.date;
  const userFilter = canManage(user) && req.query.allUsers === '1' ? '' : 'AND user_id = ?';
  const params = userFilter ? [user.id] : [];
  const dateSql = date ? 'AND due_date = ?' : '';
  if (date) params.push(date);
  const rows = db.prepare(`SELECT * FROM tasks WHERE 1=1 ${userFilter} ${dateSql} ORDER BY due_date, due_time`).all(...params);
  ok(res, rows);
});

app.post('/api/tasks', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  if (!body.title) return fail(res, 400, '任务标题不能为空');
  const id = createId('task');
  db.prepare(
    `INSERT INTO tasks (id, user_id, title, type, priority, due_date, due_time, status, related_type, related_id, note, created_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    body.user_id || user.id,
    body.title,
    body.type ?? 'todo',
    body.priority ?? 'medium',
    body.due_date || null,
    body.due_time || null,
    body.related_type || null,
    body.related_id || null,
    body.note ?? '',
    nowIsoLocal(),
  );
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
});

app.patch('/api/tasks/:id', (req, res) => {
  const user = currentUser(req);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return fail(res, 404, '任务不存在');
  if (!canManage(user) && task.user_id !== user.id) return fail(res, 403, '无权限修改该任务');
  const allowed = ['title', 'type', 'priority', 'due_date', 'due_time', 'status', 'related_type', 'related_id', 'note'];
  const data = {};
  allowed.forEach((key) => {
    if (key in req.body) data[key] = req.body[key];
  });
  if (req.body.status === 'done') data.completed_at = nowIsoLocal();
  if (req.body.status === 'pending') data.completed_at = null;
  patchRow('tasks', task.id, data);
  ok(res, db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

app.delete('/api/tasks/:id', (req, res) => {
  const user = currentUser(req);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return fail(res, 404, '任务不存在');
  if (!canManage(user) && task.user_id !== user.id) return fail(res, 403, '无权限删除该任务');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  ok(res, { id: task.id });
});

app.get('/api/daily-reports', (req, res) => {
  const user = currentUser(req);
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const params = [];
  const userFilter = canManage(user) && req.query.allUsers === '1' ? '' : 'AND user_id = ?';
  if (userFilter) params.push(user.id);
  params.push(date);
  const rows = db.prepare(`SELECT * FROM daily_reports WHERE report_date = ? ${userFilter} ORDER BY updated_at DESC`).all(...params);
  ok(res, rows);
});

app.post('/api/daily-reports', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  const reportDate = body.report_date || new Date().toISOString().slice(0, 10);
  const existing = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ?').get(body.user_id || user.id, reportDate);
  const content = body.content ?? '';
  const plan = body.plan ?? '';
  const blockers = body.blockers ?? '';
  if (existing) {
    db.prepare('UPDATE daily_reports SET content = ?, plan = ?, blockers = ?, updated_at = ? WHERE id = ?').run(content, plan, blockers, nowIsoLocal(), existing.id);
    return ok(res, db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(existing.id));
  }
  const id = createId('report');
  db.prepare(
    'INSERT INTO daily_reports (id, user_id, report_date, content, plan, blockers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, body.user_id || user.id, reportDate, content, plan, blockers, nowIsoLocal(), nowIsoLocal());
  ok(res, db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(id));
});

app.post('/api/capture/email', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  const text = body.text ?? '';
  const parsed = parseEmailText(text);
  if (!parsed.subject && !parsed.body) return fail(res, 400, '未识别到邮件内容');
  let customer = body.customer_id ? findCustomer(body.customer_id) : null;
  if (!customer) {
    const emails = extractEmails(`${parsed.from} ${parsed.body}`);
    const phones = extractPhones(`${parsed.body}`);
    customer = emails.length
      ? db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL AND lower(email) = lower(?) LIMIT 1').get(emails[0])
      : null;
    if (!customer && phones.length) {
      customer = db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL AND phone = ? LIMIT 1').get(phones[0]);
    }
  }
  if (!customer) return fail(res, 404, '未匹配到客户，请选择目标客户后重试');
  const settings = getSettings();
  const now = nowIsoLocal();
  const activityId = createId('act');
  db.prepare(
    'INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(activityId, customer.id, 'email', parsed.subject || '自动抓取的邮件', parsed.body || '', parsed.date || now, user.id, now);
  db.prepare(
    'UPDATE customers SET last_followed_at = ?, follow_count = follow_count + 1, locked_until = ?, updated_at = ? WHERE id = ?',
  ).run(parsed.date || now, addDaysIso(settings.lockDays), now, customer.id);
  addLog(user, '自动抓取邮件', 'customer', customer.id, parsed.subject);
  ok(res, { activity: db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId), customer: findCustomer(customer.id) });
});

app.post('/api/capture/chat', (req, res) => {
  const user = currentUser(req);
  const body = req.body ?? {};
  const parsed = parseChatText(body.text ?? '');
  if (!parsed.messages.length) return fail(res, 400, '未识别到聊天记录');
  const customer = body.customer_id ? findCustomer(body.customer_id) : null;
  if (!customer) return fail(res, 404, '请选择目标客户');
  const settings = getSettings();
  const now = nowIsoLocal();
  const latest = parsed.messages[parsed.messages.length - 1];
  const content = parsed.messages.map((item) => `${item.dateTime} ${item.sender}：${item.content}`).join('\n');
  const occurredAt = latest.dateTime || now;
  const activityId = createId('act');
  db.prepare(
    'INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(activityId, customer.id, 'social', '社媒聊天记录归档', content, occurredAt, user.id, now);
  db.prepare(
    'UPDATE customers SET last_followed_at = ?, follow_count = follow_count + 1, locked_until = ?, updated_at = ? WHERE id = ?',
  ).run(occurredAt, addDaysIso(settings.lockDays), now, customer.id);
  addLog(user, '自动抓取社媒消息', 'customer', customer.id, `${parsed.messages.length} 条`);
  ok(res, { activity: db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId), customer: findCustomer(customer.id) });
});

const captureTemplates = [
  { type: 'email', title: '客户自动抓取：供应商询价邮件', text: '发件人：采购部 <sales@example.cn>\n主题：关于季度合作报价\n日期：2026-09-02 10:20\n\n您好，我们正在对比供应商，请本周内提供季度采购报价。' },
  { type: 'chat', title: '客户自动抓取：企微沟通', text: '2026-09-02 10:12 采购经理：样品已经收到，整体满意。\n2026-09-02 10:15 采购经理：麻烦把交期和起订量发我。' },
  { type: 'lead', title: '自动抓取新线索', text: '官网留资新增线索：华东贸易 李经理 13912345678' },
];

app.post('/api/simulator/capture', (req, res) => {
  const user = currentUser(req);
  const template = captureTemplates[Math.floor(Math.random() * captureTemplates.length)];
  if (template.type === 'lead') {
    const now = nowIsoLocal();
    const companyNames = ['华东贸易', '盛达科技', '启明制造', '云帆咨询', '泰和食品'];
    const contacts = ['李经理', '王总监', '赵主管', '钱老师', '孙顾问'];
    const companyName = companyNames[Math.floor(Math.random() * companyNames.length)];
    const contactName = contacts[Math.floor(Math.random() * contacts.length)];
    const phone = `139${String(Math.floor(Math.random() * 90000000) + 10000000)}`;
    const id = createId('lead');
    db.prepare(
      `INSERT INTO leads (id, company_name, contact_name, phone, email, source, tags, status, owner_id, duplicate_of, note, created_at, updated_at, deleted_at, deleted_by)
       VALUES (?, ?, ?, ?, ?, '模拟抓取', '["自动抓取"]', 'new', NULL, NULL, '由自动抓取模拟器生成。', ?, ?, NULL, NULL)`,
    ).run(id, companyName, contactName, phone, `lead${Date.now()}@example.com`, now, now);
    addLog(user, '自动抓取线索', 'lead', id, companyName);
    return ok(res, { kind: 'lead', message: `已从模拟渠道抓取新线索：${companyName} / ${contactName}` });
  }
  const customerRows = db.prepare('SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY RANDOM() LIMIT 1').all();
  if (!customerRows.length) return fail(res, 404, '没有可用于归档的客户');
  const customer = customerRows[0];
  if (template.type === 'email') {
    const parsed = parseEmailText(template.text.replace('sales@example.cn', customer.email || 'customer@example.cn'));
    const activityId = createId('act');
    const now = nowIsoLocal();
    const settings = getSettings();
    db.prepare(
      'INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
    ).run(activityId, customer.id, 'email', parsed.subject, parsed.body, parsed.date, user.id, now);
    db.prepare('UPDATE customers SET last_followed_at = ?, follow_count = follow_count + 1, locked_until = ?, updated_at = ? WHERE id = ?').run(
      parsed.date,
      addDaysIso(settings.lockDays),
      now,
      customer.id,
    );
    addLog(user, '自动抓取邮件', 'customer', customer.id, parsed.subject);
    return ok(res, { kind: 'email', message: `已抓取 ${customer.company_name} 的邮件：${parsed.subject}` });
  }
  const parsed = parseChatText(template.text);
  const activityId = createId('act');
  const now = nowIsoLocal();
  const settings = getSettings();
  const content = parsed.messages.map((item) => `${item.dateTime} ${item.sender}：${item.content}`).join('\n');
  db.prepare(
    'INSERT INTO activities (id, customer_id, lead_id, type, title, content, amount, occurred_at, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?)',
  ).run(activityId, customer.id, 'social', '社媒聊天记录归档', content, parsed.messages.at(-1)?.dateTime || now, user.id, now);
  db.prepare('UPDATE customers SET last_followed_at = ?, follow_count = follow_count + 1, locked_until = ?, updated_at = ? WHERE id = ?').run(
    parsed.messages.at(-1)?.dateTime || now,
    addDaysIso(settings.lockDays),
    now,
    customer.id,
  );
  addLog(user, '自动抓取社媒消息', 'customer', customer.id, `${parsed.messages.length} 条`);
  ok(res, { kind: 'chat', message: `已抓取 ${customer.company_name} 的 ${parsed.messages.length} 条社媒消息` });
});

app.post(
  '/api/leads/ai-batch-import',
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const texts = Array.isArray(req.body?.texts) ? req.body.texts.map((item) => String(item).trim()).filter(Boolean) : [];
    if (!texts.length) return fail(res, 400, '没有可抓取的原始文本');
    const candidates = db
      .prepare(
        `SELECT id, company_name, contact_name, phone, email, country, industry
         FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
      )
      .all();
    const result = await extractLeadBatchWithAI(texts, candidates);
    const now = nowIsoLocal();
    const duplicateIds = new Map();
    (result.duplicates ?? []).forEach((item) => {
      duplicateIds.set(Number(item.raw_index), item);
    });
    const created = [];
    const duplicates = [];

    db.exec('BEGIN');
    try {
      (result.items ?? []).forEach((item, index) => {
        const dup = duplicateIds.get(index);
        if (dup && Array.isArray(dup.candidate_ids) && dup.candidate_ids.length) {
          duplicates.push({ raw_index: index, reason: dup.reason ?? 'AI 判定为重复' });
          return;
        }
        if (!item.company_name) return;
        const id = createId('lead');
        const row = {
          id,
          company_name: item.company_name,
          contact_name: item.contact_name ?? '',
          country: item.country ?? '',
          industry: item.industry ?? '',
          phone: item.phone ?? '',
          email: item.email ?? '',
          source: '海外采购商抓取',
          tags: JSON.stringify(Array.isArray(item.tags) ? item.tags : []),
          status: 'new',
          owner_id: null,
          duplicate_of: null,
          note: item.note ?? '',
          created_at: now,
          updated_at: now,
          deleted_at: null,
          deleted_by: null,
        };
        db.prepare(
          `INSERT INTO leads (id, company_name, contact_name, country, industry, phone, email, source, tags, status, owner_id, duplicate_of, note, created_at, updated_at, deleted_at, deleted_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(...Object.values(row));
        created.push(leadOut(row));
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    addLog(user, '海外采购商批量抓取', 'lead', 'overseas', `抓取 ${texts.length} 条，入库 ${created.length} 条，重复 ${duplicates.length} 条`);
    ok(res, { created: created.length, duplicates });
  }),
);

app.post(
  '/api/ai/extract-lead',
  asyncRoute(async (req, res) => {
    const rawText = req.body?.text ?? '';
    if (!rawText.trim()) return fail(res, 400, '请粘贴需要清洗的原始线索文本');
    const extracted = await extractLeadWithAI(rawText);
    const preview = {
      company_name: extracted.company_name ?? '',
      contact_name: extracted.contact_name ?? '',
      phone: extracted.phone ?? '',
      email: extracted.email ?? '',
      country: extracted.country ?? '',
      industry: extracted.industry ?? '',
      tags: Array.isArray(extracted.tags) ? extracted.tags : [],
      source: req.body?.source || extracted.source_hint || 'AI清洗',
      note: extracted.note ?? '',
    };
    const candidateRows = db
      .prepare(
        `SELECT id, company_name, contact_name, phone, email, country, industry
         FROM leads WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 15`,
      )
      .all();
    let duplicates = [];
    if (candidateRows.length) {
      const aiResult = await checkDuplicateWithAI(preview, candidateRows);
      const duplicateMap = new Map((aiResult.duplicates ?? []).map((item) => [String(item.id), item]));
      duplicates = candidateRows
        .filter((item) => duplicateMap.has(item.id))
        .map((item) => ({ ...item, reason: duplicateMap.get(item.id)?.reason ?? 'AI 判定为重复客户' }));
    }
    addLog(currentUser(req), 'AI清洗线索文本', 'lead', 'analysis', `${rawText.slice(0, 80)}`);
    ok(res, { preview, duplicates });
  }),
);

app.post(
  '/api/customers/:id/ai-process-chat',
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const customer = findCustomer(req.params.id);
    if (!customer || customer.deleted_at) return fail(res, 404, '客户不存在');
    if (!canEditCustomer(customer, user)) return fail(res, 403, '仅客户负责人或管理员可处理沟通记录');
    const text = req.body?.text ?? '';
    if (!text.trim()) return fail(res, 400, '请粘贴客户沟通内容');

    const contacts = db.prepare('SELECT name, position, phone, email FROM contacts WHERE customer_id = ?').all(customer.id);
    const opportunities = db
      .prepare('SELECT * FROM opportunities WHERE customer_id = ? AND deleted_at IS NULL')
      .all(customer.id);
    const result = await processCustomerChatWithAI({ customer, contacts, opportunities, text });
    const updates = result.customer_updates ?? {};
    const settings = getSettings();
    const now = nowIsoLocal();
    const occurredAt = req.body?.occurred_at || now;
    const activityId = createId('act');
    const nextOpportunity = result.opportunity;

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO activities (id, customer_id, lead_id, type, title, content, source_text, amount, occurred_at, created_by, created_at)
         VALUES (?, ?, NULL, 'note', 'AI 跟进日志', ?, ?, NULL, ?, ?, ?)`,
      ).run(activityId, customer.id, result.log ?? 'AI 生成跟进日志', text, occurredAt, user.id, now);

      const country = updates.country ?? customer.country;
      const industry = updates.industry ?? customer.industry;
      const productInterest = updates.product_interest ?? customer.product_interest;
      const intentLevel = updates.intent_level ?? customer.intent_level;
      const description = updates.description ?? customer.description;
      const nextFollowAt = updates.next_follow_at ?? customer.next_follow_at;
      const budget = typeof updates.budget === 'number' ? updates.budget : customer.budget;
      db.prepare(
        `UPDATE customers SET
           country = ?, industry = ?, product_interest = ?, intent_level = ?,
           description = ?, next_follow_at = ?, budget = ?,
           last_followed_at = ?, follow_count = follow_count + 1,
           locked_until = ?, updated_at = ? WHERE id = ?`,
      ).run(country, industry, productInterest, intentLevel, description, nextFollowAt, budget, occurredAt, addDaysIso(settings.lockDays), now, customer.id);

      let opportunityId = null;
      if (nextOpportunity) {
        const stage = nextOpportunity.stage ?? 'contact';
        const progress = Number(nextOpportunity.probability ?? 15);
        if (nextOpportunity.action === 'update' && nextOpportunity.id) {
          const existing = db.prepare('SELECT * FROM opportunities WHERE id = ? AND customer_id = ?').get(nextOpportunity.id, customer.id);
          if (!existing) throw new Error('AI 返回的商机不属于该客户');
          opportunityId = existing.id;
          db.prepare(
            `UPDATE opportunities SET title = ?, product = ?, stage = ?, progress = ?, budget = ?,
             expected_close_date = ?, note = ?, updated_at = ? WHERE id = ?`,
          ).run(
            nextOpportunity.title ?? existing.title,
            nextOpportunity.product ?? existing.product,
            stage,
            progress,
            typeof nextOpportunity.budget === 'number' ? nextOpportunity.budget : existing.budget,
            nextOpportunity.expected_close_date ?? existing.expected_close_date,
            nextOpportunity.note ?? existing.note,
            now,
            existing.id,
          );
        } else {
          opportunityId = createId('opp');
          db.prepare(
            `INSERT INTO opportunities (id, customer_id, title, product, budget, stage, progress, expected_close_date, owner_id, contact_id, note, created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
          ).run(
            opportunityId,
            customer.id,
            nextOpportunity.title ?? '商机',
            nextOpportunity.product ?? '',
            typeof nextOpportunity.budget === 'number' ? nextOpportunity.budget : null,
            stage,
            progress,
            nextOpportunity.expected_close_date ?? null,
            customer.owner_id || user.id,
            nextOpportunity.note ?? '',
            now,
            now,
          );
        }
      }
      db.exec('COMMIT');
      addLog(user, 'AI处理客户沟通', 'customer', customer.id, result.log?.slice(0, 80) ?? '');
      ok(res, {
        activity: db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId),
        customer: findCustomer(customer.id),
        opportunity: opportunityId ? db.prepare('SELECT * FROM opportunities WHERE id = ?').get(opportunityId) : null,
      });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }),
);

app.post(
  '/api/tasks/ai-create',
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const text = req.body?.text ?? '';
    if (!text.trim()) return fail(res, 400, '请输入一句话任务');
    const customers = db
      .prepare('SELECT id, company_name, country, contact_name FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 30')
      .all();
    const parsed = await parseTaskWithAI(text, customers);
    const targetId = customers.some((item) => item.id === parsed.related_customer_id) ? parsed.related_customer_id : null;
    const id = createId('task');
    db.prepare(
      `INSERT INTO tasks (id, user_id, title, type, priority, due_date, due_time, status, related_type, related_id, note, created_at, completed_at)
       VALUES (?, ?, ?, 'outreach', ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
    ).run(
      id,
      req.body?.user_id || user.id,
      parsed.title ?? 'AI 生成任务',
      parsed.priority ?? 'medium',
      parsed.due_date || null,
      parsed.due_time || null,
      targetId ? 'customer' : null,
      targetId,
      parsed.note ?? '',
      nowIsoLocal(),
    );
    addLog(user, 'AI生成日程任务', 'task', id, text);
    ok(res, {
      task: db.prepare('SELECT * FROM tasks WHERE id = ?').get(id),
      reason: parsed.reason ?? '',
    });
  }),
);

app.post(
  '/api/daily-reports/generate',
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    const activities = db
      .prepare(
        `SELECT a.*, c.company_name FROM activities a
         LEFT JOIN customers c ON c.id = a.customer_id
         WHERE a.created_by = ? AND substr(a.occurred_at, 1, 10) = ? ORDER BY a.occurred_at DESC`,
      )
      .all(user.id, date);
    const tasks = db
      .prepare('SELECT * FROM tasks WHERE user_id = ? AND status = ? AND (substr(COALESCE(completed_at, created_at), 1, 10) = ? OR due_date = ?)')
      .all(user.id, 'done', date, date);
    const generated = await generateDailyReportWithAI({
      userName: user.name,
      date,
      activities,
      tasks,
    });
    const existing = db.prepare('SELECT * FROM daily_reports WHERE user_id = ? AND report_date = ?').get(user.id, date);
    const content = generated.content ?? '';
    const plan = generated.plan ?? '';
    const blockers = generated.blockers ?? '';
    if (existing) {
      db.prepare('UPDATE daily_reports SET content = ?, plan = ?, blockers = ?, updated_at = ? WHERE id = ?').run(content, plan, blockers, nowIsoLocal(), existing.id);
      return ok(res, db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(existing.id));
    }
    const id = createId('report');
    db.prepare(
      'INSERT INTO daily_reports (id, user_id, report_date, content, plan, blockers, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, user.id, date, content, plan, blockers, nowIsoLocal(), nowIsoLocal());
    addLog(user, 'AI生成工作日报', 'report', id, `${date} 日报`);
    ok(res, db.prepare('SELECT * FROM daily_reports WHERE id = ?').get(id));
  }),
);

app.get('/api/opportunities/summary', (req, res) => {
  const user = currentUser(req);
  const rows = canManage(user)
    ? db.prepare('SELECT stage, COUNT(*) AS count FROM opportunities WHERE deleted_at IS NULL GROUP BY stage').all()
    : db.prepare('SELECT stage, COUNT(*) AS count FROM opportunities WHERE deleted_at IS NULL AND owner_id = ? GROUP BY stage').all(user.id);
  const labels = {
    contact: '初步接触',
    quote: '报价',
    negotiation: '谈判',
    closed_won: '成交',
    closed_lost: '失败',
  };
  const counts = Object.fromEntries(rows.map((item) => [item.stage, item.count]));
  const active = ['contact', 'quote', 'negotiation']
    .map((stage) => `${counts[stage] ?? 0} 个${labels[stage]}`)
    .join('，');
  const text = `当前 ${active || '0 个初步接触'}${counts.closed_won ? `，已成交 ${counts.closed_won} 个` : ''}${counts.closed_lost ? `，失败 ${counts.closed_lost} 个` : ''}`;
  ok(res, { text, counts });
});

app.use((error, req, res, next) => {
  fail(res, 500, error.message || '服务器内部错误');
});

app.use('/api', (req, res) => fail(res, 404, '接口不存在'));

export default app;
