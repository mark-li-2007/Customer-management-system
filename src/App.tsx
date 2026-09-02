import { useEffect, useMemo } from 'react';
import {
  ApiOutlined,
  CalendarOutlined,
  CustomerServiceOutlined,
  DashboardOutlined,
  MenuOutlined,
  FileTextOutlined,
  FundOutlined,
  InboxOutlined,
  SettingOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Avatar, Button, Drawer, Layout, Menu, Select, Space, Typography, message } from 'antd';
import { BrowserRouter, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import type { User } from './types';
import Dashboard from './pages/Dashboard';
import LeadsPage from './pages/LeadsPage';
import CustomersPage from './pages/CustomersPage';
import CustomerArchivePage from './pages/CustomerArchivePage';
import OpportunitiesPage from './pages/OpportunitiesPage';
import SchedulePage from './pages/SchedulePage';
import CapturePage from './pages/CapturePage';
import SettingsPage from './pages/SettingsPage';

const { Header, Sider, Content } = Layout;

const pageMeta: Record<string, { title: string; subtitle: string }> = {
  '/': { title: '工作台', subtitle: '今日线索、客户跟进与商机到期概览' },
  '/leads': { title: '线索池', subtitle: '统一汇集各渠道销售线索，支持查重、分配、批量导出与回收' },
  '/customers': { title: '客户池', subtitle: '意向客户保护、销售间移交与公海回收管理' },
  '/customers/archive': { title: '客户档案', subtitle: '沉淀客户基础资料与全生命周期跟进记录' },
  '/opportunities': { title: '商机管理', subtitle: '从询盘到成交的商机阶段跟踪与到期提醒' },
  '/schedule': { title: '日程管理', subtitle: '团队工作日志、拓客任务与日历化计划管理' },
  '/capture': { title: '自动抓取', subtitle: '模拟邮件与社媒消息自动流入客户档案，支持粘贴原文解析归档' },
  '/settings': { title: '系统设置', subtitle: '配置公海回收天数、认领锁定天数与业务规则' },
};

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, users, setUser, setUsers } = useStore();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobileNav, setIsMobileNav] = useState(false);

  useEffect(() => {
    api.get<User[]>('/users').then(setUsers).catch(() => undefined);
    api
      .get<User>('/me')
      .then(setUser)
      .catch(() => {
        localStorage.setItem('demoUserId', 'u_admin');
        window.location.reload();
      });
  }, [setUser, setUsers]);

  const selected = useMemo(() => {
    if (location.pathname.startsWith('/customers/archive')) return '/customers/archive';
    if (location.pathname.startsWith('/customers')) return '/customers';
    if (location.pathname === '/') return '/';
    return location.pathname;
  }, [location.pathname]);

  const meta = pageMeta[selected] ?? pageMeta['/'];

  const switchUser = (id: string) => {
    const next = users.find((item) => item.id === id);
    if (!next) return;
    localStorage.setItem('demoUserId', id);
    setUser(next);
    message.success(`已切换为 ${next.name}`);
    window.setTimeout(() => window.location.reload(), 350);
  };

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: '工作台' },
    { key: '/leads', icon: <InboxOutlined />, label: '线索池' },
    { key: '/customers', icon: <TeamOutlined />, label: '客户池' },
    { key: '/customers/archive', icon: <FileTextOutlined />, label: '客户档案' },
    { key: '/opportunities', icon: <FundOutlined />, label: '商机管理' },
    { key: '/schedule', icon: <CalendarOutlined />, label: '日程管理' },
    { key: '/capture', icon: <ApiOutlined />, label: '自动抓取' },
    ...(user?.role !== 'sales' ? [{ key: '/settings', icon: <SettingOutlined />, label: '系统设置' }] : []),
  ];

  return (
    <Layout className="app-layout">
      <Sider
        width={218}
        theme="dark"
        breakpoint="lg"
        collapsedWidth={0}
        trigger={null}
        onBreakpoint={(broken) => {
          setIsMobileNav(broken);
          setDrawerOpen(false);
        }}
      >
        <div className="app-logo">
          <span className="app-logo-mark">
            <CustomerServiceOutlined />
          </span>
          <span>CRM 客户管理</span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          items={menuItems}
          selectedKeys={[selected]}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            borderBottom: '1px solid #e5e7eb',
            height: 64,
            lineHeight: 'normal',
          }}
        >
          <Button
            className="mobile-nav-toggle"
            type="text"
            icon={<MenuOutlined />}
            onClick={() => setDrawerOpen(true)}
            style={{ display: isMobileNav ? 'inline-flex' : 'none' }}
          />
          <Space size={14} style={{ marginLeft: 'auto' }}>
            <Select
              value={user?.id}
              style={{ width: 190 }}
              options={users.map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.role === 'admin' ? '管理员' : item.role === 'manager' ? '销售主管' : '销售'}`,
              }))}
              onChange={switchUser}
            />
            <Avatar style={{ background: user?.color || '#2563eb' }}>{user?.name?.slice(0, 1)}</Avatar>
          </Space>
        </Header>
        <Content className="app-content">
          <div className="page-wrap">
            <div className="page-head">
              <div>
                <Typography.Title level={2} className="page-title">
                  {meta.title}
                </Typography.Title>
                <p className="page-subtitle">{meta.subtitle}</p>
              </div>
            </div>
            <Outlet />
          </div>
        </Content>
      </Layout>
      <Drawer
        title="CRM 客户管理"
        placement="left"
        width={240}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        styles={{ body: { padding: 0 } }}
      >
        <Menu
          mode="inline"
          items={menuItems}
          selectedKeys={[selected]}
          onClick={({ key }) => {
            navigate(key);
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </Layout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/archive" element={<CustomerArchivePage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="/capture" element={<CapturePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
