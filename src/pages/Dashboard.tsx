import { useEffect, useState } from 'react';
import {
  AlertOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CustomerServiceOutlined,
  FileProtectOutlined,
  InboxOutlined,
  RightOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Button, Empty, List, Progress, Space, Spin, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { OPPORTUNITY_STAGES } from '../constants';
import { useStore } from '../store';
import type { DashboardData } from '../types';

const stageLabel = (key: string) => OPPORTUNITY_STAGES.find((item) => item.key === key)?.label ?? key;

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useStore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .get<DashboardData>('/dashboard')
      .then((result) => {
        if (alive) setData(result);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading || !data) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  const stats = [
    {
      label: '新线索',
      value: (data.leadCounts.new ?? 0) + (data.leadCounts.following ?? 0),
      icon: <InboxOutlined />,
      color: '#2563eb',
      bg: '#eff6ff',
      key: '/leads',
    },
    {
      label: '我的客户',
      value: user?.role === 'sales' ? data.customerCounts.active : data.customerCounts.active,
      icon: <TeamIcon />,
      color: '#0d9488',
      bg: '#f0fdfa',
      key: '/customers',
    },
    {
      label: '公海客户',
      value: data.customerCounts.public,
      icon: <FileProtectOutlined />,
      color: '#ea580c',
      bg: '#fff7ed',
      key: '/customers?scope=public',
    },
    {
      label: '进行中商机',
      value: Object.entries(data.opportunityCounts)
        .filter(([key]) => key !== 'closed_won' && key !== 'closed_lost')
        .reduce((sum, [, count]) => sum + count, 0),
      icon: <CustomerServiceOutlined />,
      color: '#7c3aed',
      bg: '#f5f3ff',
      key: '/opportunities',
    },
  ];

  const opportunityReminders = [
    ...data.opportunitiesDue.map((item) => ({ ...item, reminderState: 'overdue' as const })),
    ...data.opportunitiesUpcoming.map((item) => ({ ...item, reminderState: 'soon' as const })),
  ];

  return (
    <div>
      <div className="stat-grid">
        {stats.map((item) => (
          <button
            key={item.label}
            onClick={() => navigate(item.key)}
            className="stat-item"
            style={{ cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
          >
            <div>
              <div className="stat-item-label">{item.label}</div>
              <div className="stat-item-value">{item.value}</div>
            </div>
            <span className="stat-icon" style={{ background: item.bg, color: item.color }}>
              {item.icon}
            </span>
          </button>
        ))}
      </div>

      <div className="dashboard-grid" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-title">
            <span>跟进时效与到期提醒</span>
            <Button type="link" size="small" onClick={() => navigate('/customers')}>
              查看客户池 <RightOutlined />
            </Button>
          </div>
          {data.dueCustomers.length || data.tasks.some((task) => task.overdue) ? (
            <List
              size="small"
              dataSource={[
                ...data.dueCustomers.map((item) => ({
                  title: `${item.company_name} 超过跟进时效`,
                  extra: <Tag color="volcano">即将回收</Tag>,
                  key: item.id,
                  href: '/customers/archive',
                })),
                ...data.tasks
                  .filter((task) => task.overdue)
                  .map((task) => ({
                    title: task.title,
                    extra: <Tag color="red">已逾期</Tag>,
                    key: task.id,
                    href: '/schedule',
                  })),
              ]}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="go" type="link" size="small" onClick={() => navigate(item.href)}>
                      处理
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<AlertOutlined style={{ color: '#dc2626', fontSize: 18 }} />}
                    title={item.title}
                  />
                  {item.extra}
                </List.Item>
              )}
            />
          ) : (
            <Empty description="当前没有待处理提醒" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <span>今日待办</span>
            <Button type="link" size="small" onClick={() => navigate('/schedule')}>
              日程管理 <RightOutlined />
            </Button>
          </div>
          <List
            size="small"
            dataSource={data.tasks.filter((task) => !task.overdue)}
            locale={{ emptyText: <Empty description="暂无待办" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            renderItem={(task) => (
              <List.Item>
                <List.Item.Meta
                  avatar={<CalendarOutlined style={{ color: '#2563eb', fontSize: 17 }} />}
                  title={task.title}
                  description={task.due_date || '未设置日期'}
                />
                <Tag color={task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'gold' : 'blue'}>
                  {task.priority === 'high' ? '高优先级' : task.priority === 'medium' ? '中优先级' : '低优先级'}
                </Tag>
              </List.Item>
            )}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <span>商机阶段进度</span>
          <Space size={8}>
            <span className="muted stat-pill">已到期 {data.opportunitiesDue.length} 条 · 7 日内到期 {data.opportunitiesUpcoming.length} 条</span>
          </Space>
        </div>
        {opportunityReminders.length > 0 ? (
          <List
            dataSource={opportunityReminders}
            grid={{ gutter: 12, column: 3, xs: 1, sm: 1, md: 2, lg: 3 }}
            renderItem={(item) => (
              <List.Item>
                <div className="metric-mini full-width">
                  <div className="flex-between">
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Tag color={item.reminderState === 'overdue' ? 'error' : 'warning'}>{item.reminderState === 'overdue' ? '已到期' : '7 日内到期'}</Tag>
                  </div>
                  <div className="muted" style={{ margin: '6px 0' }}>
                    预计成交：{item.expected_close_date?.slice(0, 10)}
                  </div>
                  <Space style={{ width: '100%' }}>
                    <span className="stat-pill">{stageLabel(item.stage)}</span>
                    <Progress percent={item.progress} size="small" style={{ flex: 1, margin: 0 }} />
                  </Space>
                  <Button
                    type="link"
                    size="small"
                    style={{ paddingLeft: 0, marginTop: 6 }}
                    onClick={() => navigate('/opportunities')}
                  >
                    更新进度 <RightOutlined />
                  </Button>
                </div>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="暂无到期商机" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
}

function TeamIcon() {
  return <TeamOutlined />;
}
