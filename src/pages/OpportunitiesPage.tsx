import { useEffect, useMemo, useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { OPPORTUNITY_STAGES } from '../constants';
import { useStore } from '../store';
import type { Customer, Opportunity } from '../types';

const ownerName = (id: string | null) =>
  id === 'u_a' ? '王销售A' : id === 'u_b' ? '陈销售B' : id === 'u_manager' ? '销售主管' : id === 'u_admin' ? '管理员' : '-';

export default function OpportunitiesPage() {
  const { user } = useStore();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [active, setActive] = useState<Opportunity | null>(null);
  const [summary, setSummary] = useState('');
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const [oppRows, customerRows, summaryResult] = await Promise.all([
        api.get<Opportunity[]>('/opportunities'),
        api.get<Customer[]>(`/customers?scope=${user?.role === 'sales' ? 'mine' : 'all'}`),
        api.get<{ text: string }>('/opportunities/summary'),
      ]);
      setOpportunities(oppRows);
      setCustomers(customerRows);
      setSummary(summaryResult.text);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const companyName = (customerId: string) => customers.find((item) => item.id === customerId)?.company_name ?? '未知客户';
  const groups = useMemo(
    () =>
      OPPORTUNITY_STAGES.map((stage) => ({
        ...stage,
        items: opportunities.filter((item) => item.stage === stage.key),
      })),
    [opportunities],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ stage: 'contact', owner_id: user?.id, customer_id: customers[0]?.id });
    setModalOpen(true);
  };

  const openEdit = (opportunity: Opportunity) => {
    setEditing(opportunity);
    form.setFieldsValue({
      ...opportunity,
      expected_close_date: opportunity.expected_close_date ? dayjs(opportunity.expected_close_date) : undefined,
    });
    setModalOpen(true);
  };

  const save = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      budget: values.budget ?? null,
      expected_close_date: values.expected_close_date ? values.expected_close_date.format('YYYY-MM-DD') : null,
    };
    try {
      if (editing) {
        await api.patch(`/opportunities/${editing.id}`, payload);
        message.success('商机已更新');
      } else {
        await api.post('/opportunities', payload);
        message.success('商机已创建');
      }
      setModalOpen(false);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const remove = async (opportunity: Opportunity) => {
    try {
      await api.delete(`/opportunities/${opportunity.id}`);
      message.success('商机已删除');
      setDetailOpen(false);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const moveStage = async (opportunity: Opportunity, stage: string) => {
    try {
      await api.patch(`/opportunities/${opportunity.id}`, {
        stage,
        progress: OPPORTUNITY_STAGES.find((item) => item.key === stage)?.progress,
      });
      message.success('阶段已更新');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={!customers.length}>
          新建商机
        </Button>
        <span className="muted" style={{ padding: '5px 10px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }}>
          {summary || '正在汇总商机阶段...'}
        </span>
      </div>

      <div className="kanban-row">
        {groups.map((group) => (
          <div className="kanban-col" key={group.key}>
            <div className="kanban-head">
              <span>
                <span className="kanban-dot" style={{ background: group.color }} />
                {group.label}
              </span>
              <Tag>{group.items.length}</Tag>
            </div>
            {group.items.length ? (
              group.items.map((item) => {
                const overdue =
                  item.expected_close_date &&
                  !['closed_won', 'closed_lost'].includes(item.stage) &&
                  dayjs(item.expected_close_date).isBefore(dayjs());
                const upcoming =
                  !overdue &&
                  item.expected_close_date &&
                  !['closed_won', 'closed_lost'].includes(item.stage) &&
                  dayjs(item.expected_close_date).isBefore(dayjs().add(7, 'day'));
                return (
                  <div
                    className="kanban-card"
                    key={item.id}
                    onClick={() => {
                      setActive(item);
                      setDetailOpen(true);
                    }}
                  >
                    <div className="flex-between" style={{ gap: 8, marginBottom: 7 }}>
                      <Typography.Text strong ellipsis style={{ maxWidth: 145 }}>
                        {item.title}
                      </Typography.Text>
                      {overdue ? <Tag color="red">已到期</Tag> : upcoming ? <Tag color="orange">7 日内</Tag> : null}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                      {companyName(item.customer_id)}
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                      {item.product || '未填产品'} · ¥{item.budget?.toLocaleString() ?? '-'}
                    </div>
                    <Space style={{ width: '100%' }}>
                      <span style={{ fontSize: 12, minWidth: 30 }}>{item.progress}%</span>
                      <Progress percent={item.progress} size="small" strokeColor={group.color} style={{ margin: 0, flex: 1 }} />
                    </Space>
                    <div className="flex-between muted" style={{ marginTop: 7, fontSize: 12 }}>
                      <span>负责人 {ownerName(item.owner_id)}</span>
                      <span>{item.expected_close_date?.slice(5) || '未设置'}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty description="暂无商机" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '22px 0' }} />
            )}
          </div>
        ))}
      </div>

      <Modal title={editing ? '编辑商机' : '新建商机'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={save} width={680} destroyOnClose>
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="customer_id" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                options={customers.map((item) => ({ value: item.id, label: item.company_name }))}
              />
            </Form.Item>
            <Form.Item name="title" label="商机名称" rules={[{ required: true, message: '请输入商机名称' }]}>
              <Input placeholder="例如：工业检测设备采购" />
            </Form.Item>
            <Form.Item name="product" label="意向产品">
              <Input placeholder="客户咨询的产品或服务" />
            </Form.Item>
            <Form.Item name="budget" label="预算（元）">
              <InputNumber style={{ width: '100%' }} min={0} step={10000} />
            </Form.Item>
            <Form.Item name="stage" label="当前阶段">
              <Select options={OPPORTUNITY_STAGES.map((item) => ({ value: item.key, label: item.label }))} />
            </Form.Item>
            <Form.Item name="progress" label="成交概率（%）">
              <Select
                options={[0, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100].map((value) => ({
                  value,
                  label: `${value}%`,
                }))}
              />
            </Form.Item>
            <Form.Item name="expected_close_date" label="预计成交日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="owner_id" label="负责人">
              <Select
                options={[
                  { value: 'u_a', label: '王销售A' },
                  { value: 'u_b', label: '陈销售B' },
                  { value: 'u_manager', label: '销售主管' },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} placeholder="客户询盘、预算约束或下一步安排" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={active?.title}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={
          <Space>
            <Popconfirm title="确认删除该商机？" onConfirm={() => active && remove(active)}>
              <Button danger>删除</Button>
            </Popconfirm>
            <Button
              type="primary"
              onClick={() => {
                if (active) openEdit(active);
                setDetailOpen(false);
              }}
            >
              编辑商机
            </Button>
          </Space>
        }
        width={560}
      >
        {active ? (
          <div>
            <div className="muted" style={{ marginBottom: 12 }}>
              {companyName(active.customer_id)} · 负责人 {ownerName(active.owner_id)}
            </div>
            <div style={{ marginBottom: 14 }}>
              <span className="muted">当前阶段：</span>
              <Select
                style={{ width: 160 }}
                value={active.stage}
                onChange={(value) => moveStage(active, value)}
                options={OPPORTUNITY_STAGES.map((item) => ({ value: item.key, label: item.label }))}
              />
            </div>
            <Progress percent={active.progress} />
            <div style={{ marginTop: 12 }} className="muted">
              意向产品：{active.product || '-'}
            </div>
            <div style={{ marginTop: 6 }} className="muted">
              预算：¥{active.budget?.toLocaleString() ?? '-'}
            </div>
            <div style={{ marginTop: 6 }} className="muted">
              预计成交：{active.expected_close_date || '-'}
            </div>
            {active.note ? <p style={{ marginTop: 12, lineHeight: 1.8 }}>{active.note}</p> : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
