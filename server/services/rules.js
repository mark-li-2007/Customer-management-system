export const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (value) => String(value).padStart(2, '0');

function isoString(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function addDaysIso(days, base = new Date()) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return isoString(date);
}

export function lockUntilIso(days, base = new Date()) {
  return addDaysIso(days, base);
}

export function followDeadline(customer, recycleDays, base = new Date()) {
  if (!customer.owner_id || !customer.last_followed_at) return null;
  return addDaysIso(recycleDays, customer.last_followed_at);
}

export function shouldAutoRecycle(customer, recycleDays, base = new Date()) {
  if (!customer.owner_id || customer.deleted_at || customer.status === 'public') return false;
  const now = base instanceof Date ? base : new Date(base);
  if (customer.locked_until && new Date(customer.locked_until) > now) return false;
  if (!customer.last_followed_at) return false;
  const lastFollowed = new Date(customer.last_followed_at);
  return now.getTime() - lastFollowed.getTime() >= recycleDays * DAY_MS;
}

export function canClaimCustomer(customer, user, base = new Date()) {
  if (!customer || customer.deleted_at || customer.owner_id) return false;
  if (!user || !['sales', 'manager', 'admin'].includes(user.role)) return false;
  if (customer.locked_until && new Date(customer.locked_until) > base) return false;
  return true;
}

export function canEditCustomer(customer, user, base = new Date()) {
  if (!user || !customer || customer.deleted_at) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  if (user.role !== 'sales') return false;
  if (!customer.owner_id) return false;
  if (customer.owner_id !== user.id) return false;
  return true;
}

export function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function groupDuplicateCandidates(rows) {
  const buckets = new Map();
  rows.forEach((row, index) => {
    const keys = [
      row.phone ? `phone:${normalizeKey(row.phone)}` : null,
      row.email ? `email:${normalizeKey(row.email)}` : null,
      row.company_name ? `company:${normalizeKey(row.company_name)}` : null,
    ].filter(Boolean);
    keys.forEach((key) => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ row, index, key });
    });
  });

  const seenGroups = new Set();
  const groups = [];
  buckets.forEach((items) => {
    if (items.length < 2) return;
    const signature = [...new Set(items.map((item) => item.index))].sort((a, b) => a - b).join('|');
    if (seenGroups.has(signature)) return;
    seenGroups.add(signature);
    groups.push({
      reason: items[0].key.split(':')[0],
      rows: [...new Set(items.map((item) => item.row))],
    });
  });
  return groups;
}
