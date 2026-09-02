import { useEffect, useState } from 'react';
import { SaveOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Form, InputNumber, List, message, Spin, Tag } from 'antd';
import { api } from '../api';
import { useStore } from '../store';
import type { Settings } from '../types';

export default function SettingsPage() {
  const { user } = useStore();
  const [settings, setSettings] = useState<Settings>({ recycleDays: 30, lockDays: 7 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    api
      .get<Settings>('/settings')
      .then((result) => {
        setSettings(result);
        form.setFieldsValue(result);
      })
      .finally(() => setLoading(false));
  }, [form]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (user?.role === 'sales') {
    return (
      <div className="panel">
        <Empty description="系统设置仅管理员和销售主管可见" />
      </div>
    );
  }

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const result = await api.put<Settings>('/settings', values);
      setSettings(result);
      message.success('业务规则已更新');
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="archive-grid">
      <div className="panel">
        <div className="panel-title">公海与认领规则</div>
        <Form form={form} layout="vertical">
          <Form.Item
            name="recycleDays"
            label="公海回收天数"
            extra="客户在最后跟进后超过该天数未继续跟进，且未处于锁定期时，系统将提示并回收至公海。"
            rules={[{ required: true, message: '请输入回收天数' }]}
          >
            <InputNumber min={1} max={365} addonAfter="天" style={{ width: 220 }} />
          </Form.Item>
          <Form.Item
            name="lockDays"
            label="认领锁定天数"
            extra="销售认领、接管或录入跟进后，客户在该天数内仅负责人可编辑，避免撞客。"
            rules={[{ required: true, message: '请输入锁定天数' }]}
          >
            <InputNumber min={1} max={365} addonAfter="天" style={{ width: 220 }} />
          </Form.Item>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            保存规则
          </Button>
        </Form>
      </div>

      <div>
        <div className="panel">
          <div className="panel-title">当前生效规则</div>
          <List
            dataSource={[
              { label: '公海回收天数', value: settings.recycleDays, color: 'volcano' },
              { label: '认领锁定天数', value: settings.lockDays, color: 'blue' },
              { label: '当前操作身份', value: user?.name ?? '-', color: user?.role === 'admin' ? 'purple' : user?.role === 'manager' ? 'cyan' : 'green' },
            ]}
            renderItem={(item) => (
              <List.Item>
                <span>{item.label}</span>
                <Tag color={item.color}>{item.value}</Tag>
              </List.Item>
            )}
          />
        </div>
        <Alert
          type="info"
          showIcon
          message="演示数据与规则会保存到本地 SQLite 文件"
          description="修改后立即生效，管理员和销售主管可以随时调整回收与锁定策略。"
        />
      </div>
    </div>
  );
}
