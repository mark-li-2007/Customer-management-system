import { createId, db, getSettings, nowIsoLocal } from '../db.js';
import { shouldAutoRecycle } from './rules.js';

export function runRecycleCheck() {
  const settings = getSettings();
  const candidates = db
    .prepare(
      `SELECT * FROM customers
       WHERE deleted_at IS NULL
         AND owner_id IS NOT NULL
         AND status != 'public'`,
    )
    .all();
  let recycled = 0;
  candidates.forEach((customer) => {
    if (!shouldAutoRecycle(customer, settings.recycleDays)) return;
    const now = nowIsoLocal();
    db.prepare('UPDATE customers SET owner_id = NULL, status = ?, locked_until = NULL, updated_at = ? WHERE id = ?').run(
      'public',
      now,
      customer.id,
    );
    db.prepare(
      'INSERT INTO operation_logs (id, user_id, action, target_type, target_id, detail, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
    ).run(
      createId('op'),
      '自动回收至公海',
      'customer',
      customer.id,
      `${customer.company_name} 超过 ${settings.recycleDays} 天未跟进`,
      now,
    );
    recycled += 1;
  });
  return recycled;
}
