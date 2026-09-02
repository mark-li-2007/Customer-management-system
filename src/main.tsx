import React from 'react';
import ReactDOM from 'react-dom/client';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { StoreProvider } from './store';
import './index.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2563eb',
          colorInfo: '#0891b2',
          colorSuccess: '#16a34a',
          colorWarning: '#ea580c',
          colorError: '#dc2626',
          borderRadius: 6,
          fontFamily: "'Microsoft YaHei', 'PingFang SC', sans-serif",
        },
        components: {
          Layout: { siderBg: '#101828', headerBg: '#ffffff' },
          Menu: { darkItemBg: '#101828', darkSubMenuItemBg: '#101828', darkItemSelectedBg: '#2563eb' },
        },
      }}
    >
      <StoreProvider>
        <App />
      </StoreProvider>
    </ConfigProvider>
  </React.StrictMode>,
);
