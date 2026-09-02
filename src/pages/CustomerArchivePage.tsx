import { useEffect, useMemo, useState } from 'react';
import {
  ApiOutlined,
  EditOutlined,
  LockOutlined,
  MailOutlined,
  MessageOutlined,
  PhoneOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  message,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { OPPORTUNITY_STAGES } from '../constants';
import { useStore } from '../store';
import type { Activity, ActivityType, Contact, Customer, CustomerCard, Opportunity, Settings } from '../types';

const activityMeta: Record<ActivityType, { label: string; color: string; icon: React.ReactNode }> = {
  note: { label: '跟进日志', color: 'blue', icon: <EditOutlined /> },
  call: { label: '电话', color: 'cyan', icon: <PhoneOutlined /> },
  email: { label: '邮件', color: 'geekblue', icon: <MailOutlined /> },
  social: { label: '社媒', color: 'green', icon: <MessageOutlined /> },
  quote: { label: '报价', color: 'gold', icon: <SendOutlined /> },
  system: { label: '系统', color: 'default', icon: <ApiOutlined /> },
};

const ownerName = (id: string) =>
  id === 'u_a' ? '王销售A' : id === 'u_b' ? '陈销售B' : id === 'u_manager' ? '销售主管' : id === 'u_admin' ? '管理员' : id;

export default function CustomerArchivePage() {
  const { user } = useStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<CustomerCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [settings, setSettings] = useState<Settings>({ recycleDays: 30, lockDays: 7 });
  const [followOpen, setFollowOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatText, setAiChatText] = useState('');
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiChatResult, setAiChatResult] = useState<{
    activity: Activity;
    customer: Customer;
    opportunity: Opportunity | null;
  } | null>(null);
  const [searchText, setSearchText] = useState('');
  const [followForm] = Form.useForm();
  const [contactForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [captureForm] = Form.useForm();

  const selectedId = searchParams.get('customerId') || '';
  const selectedCustomer = card?.customer;

  useEffect(() => {
    api.get<Settings>('/settings').then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    setLoading(true);
    const loadCustomers = async () => {
      const mine = await api.get<Customer[]>(`/customers?scope=${user?.role === 'sales' ? 'mine' : 'all'}`);
      const publicRows = user?.role === 'sales' ? await api.get<Customer[]>('/customers?scope=public') : [];
      const allRows = [...mine, ...publicRows];
      setCustomers(allRows);
      if (!selectedId && allRows.length) setSearchParams({ customerId: allRows[0].id }, { replace: true });
    };
    loadCustomers()
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [setSearchParams, user?.role]);

  useEffect(() => {
    if (!selectedId) {
      setCard(null);
      return;
    }
    setCardLoading(true);
    api
      .get<CustomerCard>(`/customers/${selectedId}/card`)
      .then(setCard)
      .catch((error) => message.error((error as Error).message))
      .finally(() => setCardLoading(false));
  }, [selectedId]);

  const isPublic = Boolean(selectedCustomer && !selectedCustomer.owner_id);
  const isLocked = Boolean(selectedCustomer?.locked_until && dayjs(selectedCustomer.locked_until).isAfter(dayjs()));
  const canEdit =
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    (selectedCustomer?.owner_id === user?.id && Boolean(selectedCustomer?.owner_id));

  const openFollow = () => {
    if (isPublic) {
      message.info('公海客户请先认领后再录入跟进');
      return;
    }
    followForm.resetFields();
    setFollowOpen(true);
  };

  const submitFollow = async () => {
    const values = await followForm.validateFields();
    try {
      await api.post(`/customers/${selectedId}/follow`, {
        type: values.type,
        title: values.title,
        content: values.content,
        occurred_at: values.occurred_at || undefined,
      });
      message.success('跟进日志已沉淀');
      setFollowOpen(false);
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitContact = async () => {
    const values = await contactForm.validateFields();
    try {
      await api.post(`/customers/${selectedId}/contacts`, values);
      message.success('联系人已新增');
      setContactOpen(false);
      contactForm.resetFields();
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitEdit = async () => {
    const values = await editForm.validateFields();
    try {
      await api.patch(`/customers/${selectedId}`, values);
      message.success('档案已更新');
      setEditOpen(false);
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitCapture = async () => {
    const values = await captureForm.validateFields();
    try {
      await api.post(values.kind === 'email' ? '/capture/email' : '/capture/chat', {
        customer_id: selectedId,
        text: values.text,
      });
      message.success('抓取内容已自动归档');
      setCaptureOpen(false);
      captureForm.resetFields();
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const submitAiChat = async () => {
    if (!aiChatText.trim()) {
      message.warning('请粘贴客户沟通内容');
      return;
    }
    setAiChatLoading(true);
    try {
      const result = await api.post<{
        activity: Activity;
        customer: Customer;
        opportunity: Opportunity | null;
      }>(`/customers/${selectedId}/ai-process-chat`, { text: aiChatText });
      setAiChatResult(result);
      setAiChatText('');
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
      message.success('AI 已生成跟进日志并更新客户档案');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAiChatLoading(false);
    }
  };

  const claim = async () => {
    try {
      await api.post(`/customers/${selectedId}/claim`);
      message.success(`认领成功，锁定 ${settings.lockDays} 天`);
      const refreshed = await api.get<CustomerCard>(`/customers/${selectedId}/card`);
      setCard(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const timelineItems = useMemo(() => {
    if (!card) return [];
    return card.activities.map((activity: Activity) => {
      const meta = activityMeta[activity.type] ?? activityMeta.note;
      return {
        color: meta.color === 'default' ? 'gray' : meta.color,
        children: (
          <div className="activity-item">
            <div className="flex-between">
              <Space>
                <Tag color={meta.color}>{meta.label}</Tag>
                <span className="activity-title">{activity.title}</span>
              </Space>
              <span className="muted">{dayjs(activity.occurred_at).format('YYYY-MM-DD HH:mm')}</span>
            </div>
            {activity.content ? <div style={{ margin: '7px 0 0 4px', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{activity.content}</div> : null}
            {activity.source_text ? (
              <details style={{ margin: '7px 0 0 4px' }}>
                <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: 12 }}>查看原始沟通记录</summary>
                <p className="muted" style={{ marginTop: 6, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                  {activity.source_text}
                </p>
              </details>
            ) : null}
            {activity.amount ? <div style={{ marginTop: 6 }}>金额：¥{activity.amount.toLocaleString()}</div> : null}
            <div className="muted" style={{ marginTop: 6 }}>
              记录人：{ownerName(activity.created_by)}
            </div>
          </div>
        ),
      };
    });
  }, [card]);

  const filteredCustomers = useMemo(() => {
    const value = searchText.trim().toLowerCase();
    if (!value) return customers;
    return customers.filter(
      (item) =>
        item.company_name.toLowerCase().includes(value) ||
        item.contact_name?.toLowerCase().includes(value) ||
        item.phone?.toLowerCase().includes(value),
    );
  }, [customers, searchText]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="archive-grid">
      <div className="panel">
        <div className="panel-title">客户列表</div>
        <Input.Search placeholder="搜索客户" allowClear style={{ marginBottom: 10 }} onChange={(event) => setSearchText(event.target.value)} />
        <List
          dataSource={filteredCustomers.slice(0, 40)}
          loading={loading}
          locale={{ emptyText: <Empty description="暂无可见客户" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          renderItem={(item) => (
            <List.Item
              style={{
                cursor: 'pointer',
                borderRadius: 8,
                padding: '8px 10px',
                background: item.id === selectedId ? '#eff6ff' : 'transparent',
              }}
              onClick={() => setSearchParams({ customerId: item.id }, { replace: true })}
            >
              <List.Item.Meta
                avatar={<UserOutlined style={{ fontSize: 18, color: item.owner_id ? '#2563eb' : '#ea580c' }} />}
                title={item.company_name}
                description={
                  <Space size={4} wrap>
                    {item.owner_id ? <span>{ownerName(item.owner_id)}</span> : <Tag color="orange">公海</Tag>}
                    <span>跟进 {item.follow_count} 次</span>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </div>

      <div>
        {cardLoading || !card ? (
          <div className="panel" style={{ textAlign: 'center', padding: 50 }}>
            <Spin />
          </div>
        ) : (
          <>
            <div className="panel">
              <div className="flex-between">
                <Space size={12} align="start">
                  <div className="customer-summary">
                    <Typography.Title level={3} style={{ margin: 0 }}>
                      {card.customer.company_name}
                    </Typography.Title>
                    <Space wrap>
                      {card.customer.industry ? <Tag>{card.customer.industry}</Tag> : null}
                      {isPublic ? <Tag color="orange">公海客户</Tag> : <Tag color={isLocked ? 'blue' : 'green'}>{isLocked ? `已锁定至 ${dayjs(card.customer.locked_until).format('MM-DD')}` : '正常跟进'}</Tag>}
                    </Space>
                  </div>
                </Space>
                <Space>
                  {isPublic ? (
                    <Button type="primary" icon={<SendOutlined />} onClick={claim}>
                      认领并锁定
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <>
                      <Button type="primary" icon={<RobotOutlined />} onClick={() => setAiChatOpen(true)}>
                        AI 处理沟通
                      </Button>
                      <Button type="primary" icon={<EditOutlined />} onClick={openFollow}>
                        记录跟进
                      </Button>
                      <Button icon={<ApiOutlined />} onClick={() => setCaptureOpen(true)}>
                        自动抓取归档
                      </Button>
                    </>
                  ) : null}
                  {canEdit ? (
                    <Button
                      icon={<EditOutlined />}
                      onClick={() => {
                        editForm.setFieldsValue(card.customer);
                        setEditOpen(true);
                      }}
                    >
                      编辑档案
                    </Button>
                  ) : null}
                </Space>
              </div>
              <Divider style={{ margin: '16px 0' }} />
              <Descriptions
                column={{ xs: 1, sm: 2, md: 3 }}
                size="small"
                items={[
                  { key: 'contact', label: '主要联系人', children: card.customer.contact_name || '-' },
                  { key: 'phone', label: '手机号', children: card.customer.phone || '-' },
                  { key: 'email', label: '邮箱', children: card.customer.email || '-' },
                  { key: 'country', label: '国家/地区', children: card.customer.country || '-' },
                  { key: 'industry', label: '行业', children: card.customer.industry || '-' },
                  { key: 'intent', label: '意向度', children: card.customer.intent_level ? <Tag color={card.customer.intent_level === '高' ? 'red' : card.customer.intent_level === '中' ? 'gold' : 'blue'}>{card.customer.intent_level}</Tag> : '-' },
                  { key: 'product', label: '意向产品', children: card.customer.product_interest || '-' },
                  { key: 'budget', label: '预算', children: card.customer.budget ? `¥${card.customer.budget.toLocaleString()}` : '-' },
                  { key: 'website', label: '官网', children: card.customer.website || '-' },
                  { key: 'address', label: '地址', children: card.customer.address || '-' },
                  { key: 'source', label: '来源', children: card.customer.source || '-' },
                  { key: 'created', label: '建档时间', children: dayjs(card.customer.created_at).format('YYYY-MM-DD') },
                  { key: 'last', label: '最后跟进', children: card.customer.last_followed_at ? dayjs(card.customer.last_followed_at).format('YYYY-MM-DD HH:mm') : '-' },
                ]}
              />
              {card.customer.description ? (
                <p style={{ marginTop: 12 }} className="muted">
                  {card.customer.description}
                </p>
              ) : null}
            </div>

            <div className="dashboard-grid">
              <div className="panel">
                <div className="panel-title">
                  <span>跟进时间线</span>
                  <span className="muted">共 {card.activities.length} 条记录</span>
                </div>
                {card.activities.length ? (
                  <Timeline items={timelineItems} />
                ) : (
                  <Empty description="暂无跟进记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
              <div>
                <div className="panel">
                  <div className="flex-between">
                    <span className="panel-title" style={{ marginBottom: 0 }}>
                      联系人
                    </span>
                    {canEdit ? (
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          contactForm.resetFields();
                          setContactOpen(true);
                        }}
                      >
                        新增
                      </Button>
                    ) : null}
                  </div>
                  <List
                    size="small"
                    dataSource={card.contacts}
                    locale={{ emptyText: <Empty description="暂无联系人" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    renderItem={(item: Contact) => (
                      <List.Item>
                        <List.Item.Meta
                          title={
                            <Space>
                              {item.name}
                              {item.is_primary ? <Tag color="blue">主要</Tag> : null}
                            </Space>
                          }
                          description={
                            <Space direction="vertical" size={0}>
                              <span>{item.position || '未填写职位'}</span>
                              <span>{item.phone} {item.email}</span>
                            </Space>
                          }
                        />
                      </List.Item>
                    )}
                  />
                </div>
                <div className="panel">
                  <div className="panel-title">
                    <span>关联商机</span>
                    <Button type="link" size="small" onClick={() => navigate('/opportunities')}>
                      查看全部
                    </Button>
                  </div>
                  <List
                    size="small"
                    dataSource={card.opportunities}
                    locale={{ emptyText: <Empty description="暂无商机" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    renderItem={(item: Opportunity) => {
                      const stage = OPPORTUNITY_STAGES.find((one) => one.key === item.stage);
                      return (
                        <List.Item>
                          <div style={{ width: '100%' }}>
                            <div className="flex-between">
                              <Typography.Text strong>{item.title}</Typography.Text>
                              <Tag color={stage?.color}>{stage?.label}</Tag>
                            </div>
                            <div className="muted" style={{ margin: '4px 0' }}>
                              {item.product || '未填产品'} · ¥{item.budget?.toLocaleString() ?? '-'}
                            </div>
                            <Progress percent={item.progress} size="small" />
                          </div>
                        </List.Item>
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Modal
        title={`AI 处理沟通记录 - ${selectedCustomer?.company_name ?? ''}`}
        open={aiChatOpen}
        onCancel={() => {
          setAiChatOpen(false);
          setAiChatResult(null);
        }}
        width={760}
        footer={
          aiChatResult ? (
            <Button type="primary" onClick={() => { setAiChatOpen(false); setAiChatResult(null); }}>
              完成
            </Button>
          ) : (
            <Button type="primary" icon={<RobotOutlined />} loading={aiChatLoading} onClick={submitAiChat}>
              AI 生成跟进日志
            </Button>
          )
        }
        destroyOnClose
      >
        {!aiChatResult ? (
          <Input.TextArea
            value={aiChatText}
            onChange={(event) => setAiChatText(event.target.value)}
            rows={10}
            placeholder="粘贴客户聊天片段或邮件内容。系统会生成跟进日志、判断意向，并识别是否应创建或更新商机。"
          />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Alert type="success" showIcon message="AI 跟进日志" description={aiChatResult.activity.content} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="metric-mini">
                <div className="muted">国家 / 行业</div>
                <div style={{ marginTop: 5 }}>{aiChatResult.customer.country || '-'} / {aiChatResult.customer.industry || '-'}</div>
              </div>
              <div className="metric-mini">
                <div className="muted">意向度 / 产品</div>
                <div style={{ marginTop: 5 }}>
                  {aiChatResult.customer.intent_level || '-'} / {aiChatResult.customer.product_interest || '-'}
                </div>
              </div>
              <div className="metric-mini">
                <div className="muted">预算</div>
                <div style={{ marginTop: 5 }}>{aiChatResult.customer.budget ? `¥${aiChatResult.customer.budget.toLocaleString()}` : '-'}</div>
              </div>
              <div className="metric-mini">
                <div className="muted">商机判断</div>
                <div style={{ marginTop: 5 }}>
                  {aiChatResult.opportunity ? (
                    <Space wrap>
                      <span>{aiChatResult.opportunity.title}</span>
                      <Tag color={OPPORTUNITY_STAGES.find((item) => item.key === aiChatResult.opportunity?.stage)?.color}>
                        {OPPORTUNITY_STAGES.find((item) => item.key === aiChatResult.opportunity?.stage)?.label}
                      </Tag>
                      <span>{aiChatResult.opportunity.progress}%</span>
                    </Space>
                  ) : (
                    '本次未识别到新商机'
                  )}
                </div>
              </div>
            </div>
          </Space>
        )}
      </Modal>

      <Modal title="记录跟进" open={followOpen} onCancel={() => setFollowOpen(false)} onOk={submitFollow} width={640} destroyOnClose>
        <Form form={followForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="type" label="类型" initialValue="note">
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
            <Form.Item name="occurred_at" label="发生时间" initialValue={dayjs().format('YYYY-MM-DDTHH:mm:ss')}>
              <Input disabled />
            </Form.Item>
          </div>
          <Form.Item name="title" label="主题">
            <Input placeholder="本次跟进主题" />
          </Form.Item>
          <Form.Item name="content" label="沟通内容" rules={[{ required: true, message: '请填写沟通内容' }]}>
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="新增联系人" open={contactOpen} onCancel={() => setContactOpen(false)} onOk={submitContact} width={520} destroyOnClose>
        <Form form={contactForm} layout="vertical">
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position" label="职位">
            <Input />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="phone" label="手机">
              <Input />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="wechat" label="微信">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="编辑客户档案" open={editOpen} onCancel={() => setEditOpen(false)} onOk={submitEdit} width={640} destroyOnClose>
        <Form form={editForm} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="company_name" label="公司名称">
              <Input />
            </Form.Item>
            <Form.Item name="industry" label="行业">
              <Input />
            </Form.Item>
            <Form.Item name="country" label="国家 / 地区">
              <Input />
            </Form.Item>
            <Form.Item name="intent_level" label="意向度">
              <Select allowClear options={[{ value: '高', label: '高' }, { value: '中', label: '中' }, { value: '低', label: '低' }]} />
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
            <Form.Item name="phone" label="手机">
              <Input />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input />
            </Form.Item>
            <Form.Item name="website" label="官网">
              <Input />
            </Form.Item>
          </div>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="description" label="企业备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="自动抓取归档" open={captureOpen} onCancel={() => setCaptureOpen(false)} onOk={submitCapture} width={720} destroyOnClose>
        <Form form={captureForm} layout="vertical" initialValues={{ kind: 'email' }}>
          <Form.Item name="kind" label="抓取类型">
            <Select
              options={[
                { value: 'email', label: '邮件原文' },
                { value: 'chat', label: '社媒聊天记录' },
              ]}
            />
          </Form.Item>
          <Form.Item name="text" label="粘贴原始内容" rules={[{ required: true, message: '请粘贴需要解析的原始内容' }]}>
            <Input.TextArea rows={10} placeholder="系统会自动识别发件人、主题、时间、正文并归档到该客户的时间线" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
