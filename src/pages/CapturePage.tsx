import { useEffect, useRef, useState } from 'react';
import { ApiOutlined, PauseCircleOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Empty, Form, Input, Select, Space, Tag, message } from 'antd';
import dayjs from 'dayjs';
import { api } from '../api';
import { useStore } from '../store';
import type { Customer, SimulatorResult } from '../types';

interface StreamItem {
  time: string;
  text: string;
  kind: string;
}

export default function CapturePage() {
  const { user } = useStore();
  const [stream, setStream] = useState<StreamItem[]>([]);
  const [autoRunning, setAutoRunning] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [form] = Form.useForm();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .get<Customer[]>(`/customers?scope=${user?.role === 'sales' ? 'mine' : 'all'}`)
      .then(setCustomers)
      .catch(() => undefined);
  }, [user?.role]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  const append = (item: StreamItem) => {
    setStream((prev) => [item, ...prev].slice(0, 60));
  };

  const captureOnce = async () => {
    try {
      const result = await api.post<SimulatorResult>('/simulator/capture');
      append({ time: dayjs().format('HH:mm:ss'), text: result.message, kind: result.kind });
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const toggleAuto = () => {
    if (autoRunning) {
      setAutoRunning(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
      return;
    }
    setAutoRunning(true);
    timerRef.current = window.setInterval(() => {
      captureOnce();
    }, 6000);
  };

  const submitManual = async () => {
    const values = await form.validateFields();
    try {
      const result = await api.post<{ activity: { title: string } }>(
        values.kind === 'email' ? '/capture/email' : '/capture/chat',
        { customer_id: values.customer_id, text: values.text },
      );
      append({
        time: dayjs().format('HH:mm:ss'),
        text: `已归档到 ${customers.find((item) => item.id === values.customer_id)?.company_name ?? '客户'}：${result.activity.title}`,
        kind: values.kind,
      });
      message.success('内容已解析并归档');
      form.resetFields(['text']);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div className="archive-grid">
      <div>
        <div className="panel">
          <div className="panel-title">
            <span>抓取运行台</span>
            <Space>
              <Button icon={<ApiOutlined />} onClick={captureOnce}>
                抓取一次
              </Button>
              <Button type={autoRunning ? 'default' : 'primary'} icon={autoRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={toggleAuto}>
                {autoRunning ? '停止自动抓取' : '开始自动抓取'}
              </Button>
            </Space>
          </div>
          <p className="tool-description">自动模式每 6 秒从模拟渠道抓取一次线索或消息，并直接汇入线索池或客户档案。</p>
          <div className="stream-box">
            {stream.length ? (
              stream.map((item, index) => (
                <p className="stream-line" key={`${item.time}-${index}`}>
                  <span className="stream-time">[{item.time}]</span>
                  <Tag color={item.kind === 'lead' ? 'cyan' : item.kind === 'email' ? 'blue' : 'green'} style={{ marginLeft: 6 }}>
                    {item.kind === 'lead' ? '线索' : item.kind === 'email' ? '邮件' : '社媒'}
                  </Tag>
                  <span>{item.text}</span>
                </p>
              ))
            ) : (
              <Empty description="等待抓取事件" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ color: '#94a3b8' }} />
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-title">
          <span>粘贴原文归档</span>
          <Tag color="blue">演示解析器</Tag>
        </div>
        <p className="tool-description">支持粘贴邮件原文或社媒聊天记录，系统自动识别发件人、主题、时间和对话消息。</p>
        <Form form={form} layout="vertical" initialValues={{ kind: 'email' }}>
          <Form.Item name="kind" label="内容类型">
            <Select
              options={[
                { value: 'email', label: '邮件原文' },
                { value: 'chat', label: '社媒聊天记录' },
              ]}
            />
          </Form.Item>
          <Form.Item name="customer_id" label="目标客户" rules={[{ required: true, message: '请选择目标客户' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择需要归档的客户"
              options={customers.map((item) => ({ value: item.id, label: item.company_name }))}
            />
          </Form.Item>
          <Form.Item name="text" label="原始内容" rules={[{ required: true, message: '请粘贴内容' }]}>
            <Input.TextArea rows={10} placeholder={'发件人：陈晨 <chenchen@xinrui.cn>\n主题：关于方案评审时间\n日期：2026-09-01 14:30\n\n王经理您好，我们计划下周二做内部评审。'} />
          </Form.Item>
          <Button type="primary" icon={<PlusOutlined />} onClick={submitManual}>
            解析并归档
          </Button>
        </Form>
      </div>
    </div>
  );
}
