import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckOutlined, PlusOutlined, RobotOutlined, UndoOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Calendar,
  DatePicker,
  Empty,
  Form,
  Input,
  List,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  TimePicker,
} from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { api } from '../api';
import { TASK_TYPES } from '../constants';
import { useStore } from '../store';
import type { DailyReport, Task } from '../types';

const ownerName = (id: string) =>
  id === 'u_a' ? '王销售A' : id === 'u_b' ? '陈销售B' : id === 'u_manager' ? '销售主管' : id === 'u_admin' ? '管理员' : id;

export default function SchedulePage() {
  const { user } = useStore();
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskOpen, setTaskOpen] = useState(false);
  const [aiTaskOpen, setAiTaskOpen] = useState(false);
  const [aiTaskText, setAiTaskText] = useState('');
  const [aiTaskLoading, setAiTaskLoading] = useState(false);
  const [aiTaskResult, setAiTaskResult] = useState<{ task: Task; reason: string } | null>(null);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [taskForm] = Form.useForm();
  const dateKey = selectedDate.format('YYYY-MM-DD');

  const loadAll = useCallback(async () => {
    const taskRows = await api.get<Task[]>(isManager ? '/tasks?allUsers=1' : '/tasks');
    setAllTasks(taskRows);
  }, [isManager]);

  useEffect(() => {
    loadAll().catch((error) => message.error((error as Error).message));
  }, [loadAll]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get<Task[]>(`/tasks?date=${dateKey}${isManager ? '&allUsers=1' : ''}`),
      api.get<DailyReport[]>(`/daily-reports?date=${dateKey}${isManager ? '&allUsers=1' : ''}`),
    ])
      .then(([taskRows, reportRows]) => {
        setTasks(taskRows);
        setReports(reportRows);
      })
      .catch((error) => message.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [dateKey, isManager]);

  const taskCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    allTasks.forEach((task) => {
      if (!task.due_date) return;
      counts.set(task.due_date, (counts.get(task.due_date) ?? 0) + 1);
    });
    return counts;
  }, [allTasks]);

  const createTask = async () => {
    const values = await taskForm.validateFields();
    try {
      await api.post('/tasks', {
        ...values,
        due_date: values.due_date?.format('YYYY-MM-DD') ?? dateKey,
        due_time: values.due_time?.format('HH:mm') ?? null,
      });
      message.success('任务已创建');
      setTaskOpen(false);
      taskForm.resetFields();
      await loadAll();
      const refreshed = await api.get<Task[]>(`/tasks?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setTasks(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const createAiTask = async () => {
    if (!aiTaskText.trim()) {
      message.warning('请输入一句话任务');
      return;
    }
    setAiTaskLoading(true);
    try {
      const result = await api.post<{ task: Task; reason: string }>('/tasks/ai-create', { text: aiTaskText });
      setAiTaskResult(result);
      setAiTaskText('');
      await loadAll();
      const refreshed = await api.get<Task[]>(`/tasks?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setTasks(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAiTaskLoading(false);
    }
  };

  const generateAiReport = async () => {
    setReportGenerating(true);
    try {
      await api.post('/daily-reports/generate', { date: dateKey });
      message.success('AI 工作日报已生成');
      const refreshed = await api.get<DailyReport[]>(`/daily-reports?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setReports(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setReportGenerating(false);
    }
  };

  const toggleTask = async (task: Task) => {
    try {
      await api.patch(`/tasks/${task.id}`, { status: task.status === 'done' ? 'pending' : 'done' });
      const refreshed = await api.get<Task[]>(`/tasks?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setTasks(refreshed);
      loadAll();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const deleteTask = async (task: Task) => {
    try {
      await api.delete(`/tasks/${task.id}`);
      message.success('任务已删除');
      const refreshed = await api.get<Task[]>(`/tasks?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setTasks(refreshed);
      loadAll();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const saveReport = async (values: { content: string; plan: string; blockers?: string }) => {
    try {
      await api.post('/daily-reports', { report_date: dateKey, ...values });
      message.success('工作日报已保存');
      const refreshed = await api.get<DailyReport[]>(`/daily-reports?date=${dateKey}${isManager ? '&allUsers=1' : ''}`);
      setReports(refreshed);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const renderCell = (date: Dayjs, info: { type: string }) => {
    if (info.type !== 'date') return null;
    const count = taskCountByDate.get(date.format('YYYY-MM-DD')) ?? 0;
    return count ? (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          color: '#2563eb',
          fontWeight: 600,
          pointerEvents: 'none',
        }}
      >
        {count} 项
      </div>
    ) : null;
  };

  return (
    <div>
      <div className="dashboard-grid">
        <div className="panel">
          <Calendar
            value={selectedDate}
            onSelect={(date) => setSelectedDate(date)}
            cellRender={renderCell}
            headerRender={({ value, type, onChange, onTypeChange }) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 12px', gap: 10 }}>
                <Space>
                  <Button onClick={() => onChange(value.clone().subtract(1, 'month'))}>上月</Button>
                  <Button onClick={() => onChange(dayjs())}>今天</Button>
                  <Button onClick={() => onChange(value.clone().add(1, 'month'))}>下月</Button>
                </Space>
                <Space>
                  <span style={{ fontWeight: 600 }}>{value.format('YYYY年MM月')}</span>
                  <Select value={type} onChange={(next) => onTypeChange(next)} style={{ width: 90 }} options={[{ value: 'month', label: '月' }, { value: 'year', label: '年' }]} />
                </Space>
              </div>
            )}
          />
        </div>

        <div>
          <div className="panel">
            <div className="flex-between">
              <span className="panel-title" style={{ marginBottom: 0 }}>
                {selectedDate.format('YYYY-MM-DD')} 任务
              </span>
              <Space>
                <Button type="primary" size="small" icon={<RobotOutlined />} onClick={() => setAiTaskOpen(true)}>
                  AI 一句话任务
                </Button>
                <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setTaskOpen(true)}>
                新建任务
                </Button>
              </Space>
            </div>
            <List
              loading={loading}
              dataSource={tasks}
              locale={{ emptyText: <Empty description="当天暂无任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              renderItem={(task) => (
                <List.Item
                  actions={[
                    <Button
                      key="toggle"
                      type="link"
                      size="small"
                      icon={task.status === 'done' ? <UndoOutlined /> : <CheckOutlined />}
                      onClick={() => toggleTask(task)}
                    >
                      {task.status === 'done' ? '恢复' : '完成'}
                    </Button>,
                    <Popconfirm key="delete" title="确认删除该任务？" onConfirm={() => deleteTask(task)}>
                      <Button type="link" danger size="small">
                        删除
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span style={{ textDecoration: task.status === 'done' ? 'line-through' : undefined }}>{task.title}</span>
                        <Tag color={task.status === 'done' ? 'green' : task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'gold' : 'blue'}>
                          {TASK_TYPES.find((item) => item.key === task.type)?.label} {task.status === 'done' ? '· 已完成' : ''}
                        </Tag>
                      </Space>
                    }
                    description={`${ownerName(task.user_id)}${task.due_time ? ` · ${task.due_time}` : ''}${task.note ? ` · ${task.note}` : ''}`}
                  />
                </List.Item>
              )}
            />
          </div>

          <div className="panel">
            <div className="flex-between">
              <span className="panel-title" style={{ marginBottom: 0 }}>
                当日工作日志
              </span>
              <Button type="link" size="small" icon={<RobotOutlined />} loading={reportGenerating} onClick={generateAiReport}>
                AI 自动生成日报
              </Button>
            </div>
            {reports.map((report) => (
              <ReportEditor key={`${report.report_date}-${report.user_id}-${report.updated_at}`} report={report} ownerName={ownerName(report.user_id)} onSave={saveReport} />
            ))}
            {!reports.length && !loading ? (
              <ReportEditor
                key={`empty-${dateKey}-${user?.id}`}
                report={null}
                ownerName={user?.name ?? '我'}
                onSave={async (values) => {
                  await saveReport(values);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        title="AI 一句话生成任务"
        open={aiTaskOpen}
        onCancel={() => {
          setAiTaskOpen(false);
          setAiTaskResult(null);
        }}
        width={680}
        footer={
          aiTaskResult ? (
            <Button type="primary" onClick={() => { setAiTaskOpen(false); setAiTaskResult(null); }}>
              完成
            </Button>
          ) : (
            <Button type="primary" icon={<RobotOutlined />} loading={aiTaskLoading} onClick={createAiTask}>
              生成任务并提醒
            </Button>
          )
        }
      >
        {!aiTaskResult ? (
          <Input.TextArea
            value={aiTaskText}
            onChange={(event) => setAiTaskText(event.target.value)}
            rows={4}
            placeholder="例如：下周三跟进德国客户 ABC，给他发新报价"
          />
        ) : (
          <Alert
            type="success"
            showIcon
            message={aiTaskResult.task.title}
            description={
              <>
                日期：{aiTaskResult.task.due_date ?? '未设置'} {aiTaskResult.task.due_time ?? ''}；优先级：{aiTaskResult.task.priority}
                {aiTaskResult.reason ? `；${aiTaskResult.reason}` : ''}
              </>
            }
          />
        )}
      </Modal>

      <Modal title="新建任务" open={taskOpen} onCancel={() => setTaskOpen(false)} onOk={createTask} width={560} destroyOnClose>
        <Form form={taskForm} layout="vertical" initialValues={{ type: 'todo', priority: 'medium', user_id: user?.id, due_date: selectedDate }}>
          <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="例如：跟进宏达机械扩产需求" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="type" label="任务类型">
              <Select options={TASK_TYPES.map((item) => ({ value: item.key, label: item.label }))} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <Select
                options={[
                  { value: 'high', label: '高' },
                  { value: 'medium', label: '中' },
                  { value: 'low', label: '低' },
                ]}
              />
            </Form.Item>
            {isManager ? (
              <Form.Item name="user_id" label="负责人">
                <Select
                  options={[
                    { value: 'u_a', label: '王销售A' },
                    { value: 'u_b', label: '陈销售B' },
                    { value: 'u_manager', label: '销售主管' },
                  ]}
                />
              </Form.Item>
            ) : null}
            <Form.Item name="due_date" label="日期" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="due_time" label="时间">
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function ReportEditor({
  report,
  ownerName: owner,
  onSave,
}: {
  report: DailyReport | null;
  ownerName: string;
  onSave: (values: { content: string; plan: string; blockers: string }) => Promise<void>;
}) {
  const [content, setContent] = useState(report?.content ?? '');
  const [plan, setPlan] = useState(report?.plan ?? '');
  const [blockers, setBlockers] = useState(report?.blockers ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <div style={{ marginTop: 8 }}>
      <Input.TextArea
        rows={3}
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder="今日完成工作"
        style={{ marginBottom: 8 }}
      />
      <Input
        value={plan}
        onChange={(event) => setPlan(event.target.value)}
        placeholder="明日计划"
        style={{ marginBottom: 8 }}
      />
      <Input value={blockers} onChange={(event) => setBlockers(event.target.value)} placeholder="遇到的问题（可选）" style={{ marginBottom: 8 }} />
      <div className="flex-between">
        <span className="muted">填写人：{owner}</span>
        <Button
          type="primary"
          size="small"
          loading={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({ content, plan, blockers });
            } finally {
              setSaving(false);
            }
          }}
        >
          保存日报
        </Button>
      </div>
    </div>
  );
}
