import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  canClaimCustomer,
  canEditCustomer,
  followDeadline,
  groupDuplicateCandidates,
  lockUntilIso,
  shouldAutoRecycle,
} from '../server/services/rules.js';

const base = new Date('2026-09-02T10:00:00');

describe('公海回收与锁定规则', () => {
  it('超过回收天数且未锁定时自动回收', () => {
    const customer = {
      owner_id: 'u_a',
      deleted_at: null,
      status: 'active',
      locked_until: null,
      last_followed_at: '2026-07-25T10:00:00',
    };
    expect(shouldAutoRecycle(customer, 30, base)).toBe(true);
  });

  it('未达到回收天数时保留给销售', () => {
    const customer = {
      owner_id: 'u_a',
      deleted_at: null,
      status: 'active',
      locked_until: null,
      last_followed_at: '2026-08-20T10:00:00',
    };
    expect(shouldAutoRecycle(customer, 30, base)).toBe(false);
  });

  it('锁定期内不自动回收', () => {
    const customer = {
      owner_id: 'u_a',
      deleted_at: null,
      status: 'active',
      locked_until: '2026-09-20T10:00:00',
      last_followed_at: '2026-06-01T10:00:00',
    };
    expect(shouldAutoRecycle(customer, 30, base)).toBe(false);
  });

  it('公海客户没有负责人时不回收', () => {
    const customer = {
      owner_id: null,
      deleted_at: null,
      status: 'public',
      locked_until: null,
      last_followed_at: '2026-01-01T10:00:00',
    };
    expect(shouldAutoRecycle(customer, 30, base)).toBe(false);
  });

  it('认领后可锁定指定天数', () => {
    expect(lockUntilIso(7, base)).toBe('2026-09-09T10:00:00');
  });

  it('计算跟进时效截止时间', () => {
    const customer = {
      owner_id: 'u_a',
      last_followed_at: '2026-08-10T10:00:00',
    };
    expect(followDeadline(customer, 30, base)).toBe(addDaysIso(30, '2026-08-10T10:00:00'));
  });

  it('非负责人不能编辑其他销售客户', () => {
    const customer = { owner_id: 'u_a', deleted_at: null };
    expect(canEditCustomer(customer, { id: 'u_b', role: 'sales' }, base)).toBe(false);
    expect(canEditCustomer(customer, { id: 'u_a', role: 'sales' }, base)).toBe(true);
  });

  it('只能认领无负责人的客户', () => {
    const owned = { owner_id: 'u_a', deleted_at: null, locked_until: null };
    const publicCustomer = { owner_id: null, deleted_at: null, locked_until: null };
    expect(canClaimCustomer(owned, { id: 'u_b', role: 'sales' }, base)).toBe(false);
    expect(canClaimCustomer(publicCustomer, { id: 'u_b', role: 'sales' }, base)).toBe(true);
  });
});

describe('线索查重', () => {
  it('按手机号或公司名识别重复线索', () => {
    const rows = [
      { id: '1', company_name: '华彩包装', phone: '13800138001' },
      { id: '2', company_name: '华彩包装', phone: '13800138099' },
      { id: '3', company_name: '博远贸易', phone: '13800138002' },
    ];
    const groups = groupDuplicateCandidates(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows.map((row) => row.id)).toEqual(['1', '2']);
  });
});
