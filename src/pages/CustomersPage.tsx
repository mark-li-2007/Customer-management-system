import { useCallback, useEffect, useState } from 'react';
import {
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SendOutlined,
  SwapOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { SOURCES } from '../constants';
import { useStore } from '../store';
import type { Customer, Settings } from '../types';

const ownerName = (id: string | null) =>
  id === 'u_a' ? '王销售A' : id === 'u_b' ? '陈销售B' : id === 'u_manager' ? '销售主管' : id === 'u_admin' ? '管理员' : '';

export default function CustomersPage() {
  const { user } = useStore();
  const navigate = useNavigate();
  const [scope, setScope] = useState(user?.role === 'sales' ? 'mine' : 'all');
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<Settings>({ recycleDays: 30, lockDays: 7 });
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [followTarget, setFollowTarget] = useState<Customer | null>(null);
  const [transferTarget, setTransferTarget] = useState<Customer | null>(null);
  const [followForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [createForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Customer[]>(`/customers?scope=${scope}${q ? `&q=${encodeURIComponent(q)}` : ''}`);
      setRows(data);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope, q]);

  useEffect(() => {
    api.get<Settings>('/settings').then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const claim = async (customer: Customer) => {
    try {
      await api.post(`/customers/${customer.id}/claim`);
      message.success(`已认领 ${customer.company_name}，锁定 ${settings.lockDays} 天`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const recycle = async (customer: Customer) => {
    try {
      await api.post(`/customers/${customer.id}/recycle`);
      message.success('已回收至公海');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitFollow = async () => {
    if (!followTarget) return;
    const values = await followForm.validateFields();
    try {
      await api.post(`/customers/${followTarget.id}/follow`, {
        type: values.type,
        title: values.title || '跟进记录',
        content: values.content,
        occurred_at: values.occurred_at?.format('YYYY-MM-DDTHH:mm:ss') || undefined,
      });
      message.success('跟进记录已写入客户档案');
      setFollowTarget(null);
      followForm.resetFields();
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitTransfer = async () => {
    if (!transferTarget) return;
    const values = await transferForm.validateFields();
    try {
      await api.post(`/customers/${transferTarget.id}/transfer`, { owner_id: values.owner_id });
      message.success('客户已移交');
      setTransferTarget(null);
      transferForm.resetFields();
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const createCustomer = async () => {
    const values = await createForm.validateFields();
    try {
      await api.post('/customers', values);
      message.success('客户已建档');
      setCreateOpen(false);
      createForm.resetFields();
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const isLocked = (customer: Customer) => Boolean(customer.locked_until && dayjs(customer.locked_until).isAfter(dayjs()));
  const isOverdue = (customer: Customer) =>
    Boolean(customer.owner_id && customer.last_followed_at && dayjs(customer.last_followed_at).add(settings.recycleDays, 'day').isBefore(dayjs()));

  const columns: ColumnsType<Customer> = [
    {
      title: '客户公司',
      dataIndex: 'company_name',
      width: 210,
      fixed: 'left',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <a onClick={() => navigate(`/customers/archive?customerId=${record.id}`)} style={{ fontWeight: 600 }}>
            {record.company_name}
          </a>
          <span className="muted">
            {record.contact_name} {record.phone ? `· ${record.phone}` : ''}
          </span>
        </Space>
      ),
    },
    {
      title: '国家 / 行业',
      dataIndex: 'country',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <span>{record.country || '-'}</span>
          <span className="muted">{record.industry || '-'}</span>
        </Space>
      ),
    },
    {
      title: '负责人',
      dataIndex: 'owner_id',
      width: 190,
      render: (value, record) =>
        value ? (
          <Space size={[0, 4]} wrap style={{ width: '100%' }}>
            <span>{ownerName(value)}</span>
            {isLocked(record) ? (
              <TooltipTag label={`锁至 ${record.locked_until?.slice(0, 10)}`} />
            ) : (
              <Tag color="green">可跟进</Tag>
            )}
          </Space>
        ) : (
          <Tag color="orange">公海客户</Tag>
        ),
    },
    {
      title: '跟进次数',
      dataIndex: 'follow_count',
      width: 90,
    },
    {
      title: '最后跟进',
      dataIndex: 'last_followed_at',
      width: 160,
      render: (value, record) =>
        value ? (
          <Space direction="vertical" size={0}>
            <span>{dayjs(value).format('YYYY-MM-DD HH:mm')}</span>
            {isOverdue(record) ? <Tag color="volcano" style={{ marginTop: 3 }}>超期 {settings.recycleDays} 天</Tag> : null}
          </Space>
        ) : (
          <span className="muted">暂无跟进</span>
        ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (value: string) => <span>{value}</span>,
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      ellipsis: true,
      render: (value: string) => value || <span className="muted">-</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: scope === 'public' ? 110 : 300,
      fixed: 'right',
      render: (_, record) => {
        if (scope === 'public') {
          return (
            <Button type="primary" size="small" icon={<SendOutlined />} onClick={() => claim(record)}>
              认领
            </Button>
          );
        }
        if (scope === 'recycle') {
          return (
            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => restore(record)}>
              恢复
            </Button>
          );
        }
        return (
          <Space size={0} wrap>
            <Button type="link" size="small" icon={<SendOutlined />} onClick={() => setFollowTarget(record)}>
              跟进
            </Button>
            <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => setTransferTarget(record)} disabled={!canManageRow(record)}>
              移交
            </Button>
            <Popconfirm title="确认回收至公海？" onConfirm={() => recycle(record)}>
              <Button type="link" danger size="small" disabled={!canManageRow(record)}>
                回收
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const canManageRow = (record: Customer) =>
    user?.role === 'admin' || user?.role === 'manager' || record.owner_id === user?.id;

  const restore = async (record: Customer) => {
    try {
      await api.post(`/customers/${record.id}/restore`);
      message.success('客户已恢复至公海');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          新建客户
        </Button>
        <Input.Search
          placeholder="搜索客户公司、联系人或手机"
          allowClear
          style={{ width: 280 }}
          onSearch={(value) => setQ(value)}
        />
      </div>

      <div className="panel">
        <Tabs
          activeKey={scope}
          onChange={(key) => setScope(key as typeof scope)}
          items={[
            ...(user?.role === 'sales'
              ? [{ key: 'mine', label: '我的客户' }, { key: 'public', label: '公海池' }]
              : [{ key: 'all', label: '全部客户' }, { key: 'mine', label: '我的客户' }, { key: 'public', label: '公海池' }]),
            { key: 'recycle', label: '回收站' },
          ]}
        />
        <Table<Customer>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1300 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </div>

      <Modal title={`跟进 - ${followTarget?.company_name ?? ''}`} open={Boolean(followTarget)} onCancel={() => setFollowTarget(null)} onOk={submitFollow} width={620} destroyOnClose>
        <Form form={followForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="type" label="沟通类型" initialValue="note">
              <Select
                options={[
                  { value: 'note', label: '跟进日志' },
                  { value: 'call', label: '电话' },
                  { value: 'email', label: '邮件' },
                  { value: 'social', label: '社媒' },
                  { value: 'quote', label: '报价' },
                ]}
              />
            </Form.Item>
            <Form.Item name="occurred_at" label="发生时间" initialValue={dayjs()}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="title" label="主题">
            <Input placeholder="本次沟通主题" />
          </Form.Item>
          <Form.Item name="content" label="沟通内容" rules={[{ required: true, message: '请填写沟通内容' }]}>
            <Input.TextArea rows={4} placeholder="记录客户反馈、需求或下一步动作" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`移交客户 - ${transferTarget?.company_name ?? ''}`} open={Boolean(transferTarget)} onCancel={() => setTransferTarget(null)} onOk={submitTransfer} width={420} destroyOnClose>
        <Form form={transferForm} layout="vertical">
          <Form.Item name="owner_id" label="接收销售" rules={[{ required: true, message: '请选择接收销售' }]}>
            <Select
              options={[
                { value: 'u_a', label: '王销售A' },
                { value: 'u_b', label: '陈销售B' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="新建客户档案" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={createCustomer} width={720} destroyOnClose>
        <Form form={createForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="company_name" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="industry" label="行业">
              <Input />
            </Form.Item>
            <Form.Item name="country" label="国家 / 地区">
              <Input />
            </Form.Item>
            <Form.Item name="product_interest" label="意向产品">
              <Input />
            </Form.Item>
            <Form.Item name="budget" label="预算（元）">
              <InputNumber style={{ width: '100%' }} min={0} step={1000} />
            </Form.Item>
            <Form.Item name="contact_name" label="主要联系人">
              <Input />
            </Form.Item>
            <Form.Item name="phone" label="手机号">
              <Input />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input />
            </Form.Item>
            <Form.Item name="source" label="来源" initialValue="手动建档">
              <Select options={SOURCES.map((item) => ({ value: item, label: item }))} />
            </Form.Item>
            <Form.Item name="website" label="网站">
              <Input />
            </Form.Item>
            <Form.Item name="address" label="地址">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="description" label="企业备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function TooltipTag({ label }: { label: string }) {
  return (
    <Tag color="blue" icon={<LockOutlined />}>
      {label}
    </Tag>
  );
}
