import { useEffect, useMemo, useRef, useState } from 'react';
import type { Key } from 'react';
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  GlobalOutlined,
  ImportOutlined,
  ReloadOutlined,
  RobotOutlined,
  SwapOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Divider,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import * as XLSX from 'xlsx';
import { api } from '../api';
import { LEAD_STATUS, SOURCES, TAG_COLORS } from '../constants';
import { useStore } from '../store';
import type { Lead } from '../types';

interface AiLeadPreview {
  company_name: string;
  contact_name: string;
  phone: string;
  email: string;
  country: string;
  industry: string;
  tags: string[];
  source: string;
  note: string;
}

interface AiExtractResult {
  preview: AiLeadPreview;
  duplicates: Array<Lead & { reason: string }>;
}

const tagColor = (index: number) => TAG_COLORS[index % TAG_COLORS.length];

export default function LeadsPage() {
  const { user } = useStore();
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Key[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignOwner, setAssignOwner] = useState<string>();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiSource, setAiSource] = useState('AI清洗');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiExtractResult | null>(null);
  const [batchImporting, setBatchImporting] = useState(false);
  const [form] = Form.useForm();
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (includeDeleted) params.set('includeDeleted', '1');
      Object.entries(filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });
      const data = await api.get<Lead[]>(`/leads?${params.toString()}`);
      setRows(data);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [includeDeleted, filters.q, filters.status, filters.source]);

  const visibleRows = useMemo(
    () => rows.filter((item) => (includeDeleted ? item.deleted_at : !item.deleted_at)),
    [rows, includeDeleted],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (lead: Lead) => {
    setEditing(lead);
    form.setFieldsValue({ ...lead, tags: lead.tags });
    setModalOpen(true);
  };

  const openCreateWithPreview = (preview: AiLeadPreview) => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      company_name: preview.company_name,
      contact_name: preview.contact_name,
      phone: preview.phone,
      email: preview.email,
      country: preview.country,
      industry: preview.industry,
      tags: preview.tags,
      source: preview.source,
      note: preview.note,
    });
    setAiOpen(false);
    setModalOpen(true);
  };

  const runAiExtract = async () => {
    if (!aiText.trim()) {
      message.warning('请先粘贴杂乱原始文本');
      return;
    }
    setAiLoading(true);
    try {
      const result = await api.post<AiExtractResult>('/ai/extract-lead', { text: aiText, source: aiSource });
      setAiResult(result);
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  const fillOverseasSample = () => {
    setAiSource('海外采购商抓取');
    setAiResult(null);
    setAiText(
      [
        'Alpha Furniture GmbH 德国法兰克福进口贸易商',
        '联系人：Katharina Weber，电话 +49 69 12345678，邮箱 k.weber@alpha-furniture.de',
        '公司官网显示主营木制家具、户外家具进口，正在寻找中国工厂，本月询价 300 套折叠桌椅，预算 4 万欧元。',
      ].join('\n'),
    );
  };

  const importOverseasBatch = async () => {
    setBatchImporting(true);
    try {
      const result = await api.post<{ created: number; duplicates: unknown[] }>('/leads/ai-batch-import', {
        texts: [
          'Alpha Furniture GmbH 德国法兰克福进口商，主页显示采购木制家具，联系人 Katharina Weber，邮箱 k.weber@alpha-furniture.de，电话 +49 69 12345678，本月询价 300 套折叠桌椅。',
          'Nordic Home Oy 芬兰赫尔辛基家居采购商，官网留资，采购负责人 Juha Laine，电话 +358 40 1234567，邮箱 juha.laine@nordichome.fi，关注户外家具与灯具。',
          'Bavaria Metal Import 德国慕尼黑，主营五金和紧固件进口，联系人 Thomas Bauer，thomas.bauer@bavaria-metal.de，正在为 2026 年新项目寻找中国供应商。',
        ],
      });
      message.success(`AI 清洗入库 ${result.created} 条海外采购商线索`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      setBatchImporting(false);
    }
  };

  const saveLead = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await api.patch(`/leads/${editing.id}`, values);
        message.success('线索已更新');
      } else {
        const result = await api.post<{ duplicates: Lead[] }>('/leads', values);
        if (result.duplicates.length) {
          Modal.warning({
            title: '检测到相似线索',
            content: `已保存，但与 ${result.duplicates.map((item) => item.company_name).join('、')} 存在联系方式或公司名重复。`,
          });
        } else {
          message.success('线索已创建');
        }
      }
      setModalOpen(false);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const batch = async (action: 'assign' | 'delete', ids: Key[] = selectedIds, ownerId?: string) => {
    if (!ids.length) {
      message.warning('请先勾选线索');
      return;
    }
    try {
      await api.post('/leads/batch', { ids, action, owner_id: ownerId });
      message.success(action === 'assign' ? '分配完成' : '已移入回收站');
      setAssignOpen(false);
      setSelectedIds([]);
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const importExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const result = await api.post<{ imported: number; duplicates: number; messages: string[] }>('/leads/import', { rows: json });
      message.success(`导入 ${result.imported} 条，跳过重复 ${result.duplicates} 条`);
      load();
    } catch (error) {
      message.error((error as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportExcel = () => {
    const data = visibleRows.map((item) => ({
      公司名称: item.company_name,
      联系人: item.contact_name,
      国家: item.country,
      行业: item.industry,
      手机: item.phone,
      邮箱: item.email,
      来源: item.source,
      标签: item.tags.join('、'),
      状态: LEAD_STATUS.find((status) => status.value === item.status)?.label ?? item.status,
      负责人: item.owner_id,
      创建时间: item.created_at,
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '线索池');
    XLSX.writeFile(workbook, `线索池-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const actionEnabled = (lead: Lead) => !includeDeleted && user?.role !== 'sales' || lead.owner_id === user?.id || !lead.owner_id;

  const columns: ColumnsType<Lead> = [
    {
      title: '公司 / 联系人',
      dataIndex: 'company_name',
      width: 220,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <span style={{ fontWeight: 600 }}>{record.company_name}</span>
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
      title: '邮箱',
      dataIndex: 'email',
      width: 200,
      render: (value: string) => value || <span className="muted">-</span>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (value: string) => (
        <Tag color={value === 'Excel导入' || value === '模拟抓取' || value === '海外采购商抓取' ? 'geekblue' : undefined}>{value}</Tag>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      width: 190,
      render: (value: string[]) =>
        value.length ? (
          <Space size={[0, 4]} wrap>
            {value.map((tag, index) => (
              <Tag key={tag} color={tagColor(index)} style={{ marginInlineEnd: 0 }}>
                {tag}
              </Tag>
            ))}
          </Space>
        ) : (
          <span className="muted">-</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 105,
      render: (value) => {
        const current = LEAD_STATUS.find((item) => item.value === value);
        return <Tag color={current?.color}>{current?.label}</Tag>;
      },
    },
    {
      title: '负责人',
      dataIndex: 'owner_id',
      width: 110,
      render: (value) =>
        value ? (
          <span>{value === 'u_a' ? '王销售A' : value === 'u_b' ? '陈销售B' : value === 'u_manager' ? '销售主管' : '管理员'}</span>
        ) : (
          <Tag color="orange">待领取</Tag>
        ),
    },
    {
      title: '备注',
      dataIndex: 'note',
      ellipsis: true,
      render: (value: string) => value || <span className="muted">-</span>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      render: (_, record) => (
        <Space size={0} split={<Divider type="vertical" />}>
          {!includeDeleted && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
                编辑
              </Button>
              <Button type="link" size="small" icon={<SwapOutlined />} onClick={() => convert(record)} disabled={record.status === 'converted'}>
                转客户
              </Button>
              <Popconfirm title="确认删除该线索？" onConfirm={() => batch('delete', [record.id])}>
                <Button type="link" danger size="small" icon={<DeleteOutlined />} disabled={!actionEnabled(record)}>
                  删除
                </Button>
              </Popconfirm>
            </>
          )}
          {includeDeleted && (
            <Button type="link" size="small" icon={<ReloadOutlined />} onClick={() => restore(record)}>
              恢复
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const convert = async (lead: Lead) => {
    try {
      await api.post(`/leads/${lead.id}/convert`);
      message.success('已创建客户档案');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const restore = async (lead: Lead) => {
    try {
      await api.post('/leads/batch', { ids: [lead.id], action: 'restore' });
      message.success('线索已恢复');
      load();
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  return (
    <div>
      <div className="toolbar">
        <Space wrap>
          <Button type="primary" icon={<GlobalOutlined />} loading={batchImporting} onClick={importOverseasBatch}>
            海外采购商抓取
          </Button>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => { setAiResult(null); setAiOpen(true); }}>
            AI 识别线索
          </Button>
          <Button type="primary" onClick={openCreate}>
            新建线索
          </Button>
          <Button
            icon={<ExportOutlined />}
            onClick={() => {
              setAssignOwner(undefined);
              setAssignOpen(true);
            }}
            disabled={!selectedIds.length}
          >
            批量分配 ({selectedIds.length})
          </Button>
          <Popconfirm title={`确认将选中的 ${selectedIds.length} 条线索移入回收站？`} onConfirm={() => batch('delete')}>
            <Button danger icon={<DeleteOutlined />} disabled={!selectedIds.length}>
              批量删除
            </Button>
          </Popconfirm>
          <Button icon={<ImportOutlined />} onClick={() => fileRef.current?.click()}>
            导入 Excel
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!visibleRows.length}>
            导出 Excel
          </Button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={importExcel} />
        </Space>
      </div>

      <div className="panel">
        <Space wrap style={{ width: '100%', marginBottom: 12 }}>
          <Input.Search
            placeholder="搜索公司、联系人、电话或邮箱"
            allowClear
            style={{ width: 280 }}
            onSearch={(value) => setFilters((prev) => ({ ...prev, q: value }))}
          />
          <Select
            allowClear
            placeholder="来源"
            style={{ width: 130 }}
            options={SOURCES.map((item) => ({ value: item, label: item }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, source: value ?? '' }))}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 130 }}
            options={LEAD_STATUS.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value) => setFilters((prev) => ({ ...prev, status: value ?? '' }))}
          />
          <Button type={includeDeleted ? 'primary' : 'default'} onClick={() => setIncludeDeleted((prev) => !prev)} icon={<TagsOutlined />}>
            {includeDeleted ? '回收站视图' : '线索回收站'}
          </Button>
        </Space>
        <Table<Lead>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={visibleRows}
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys),
            getCheckboxProps: (record) => ({ disabled: Boolean(record.deleted_at) }),
          }}
          pagination={{ pageSize: 12, showSizeChanger: false }}
          scroll={{ x: 1400 }}
        />
      </div>

      <Modal
        title="AI 智能体清洗原始线索"
        open={aiOpen}
        onCancel={() => setAiOpen(false)}
        width={760}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input.TextArea
            value={aiText}
            onChange={(event) => setAiText(event.target.value)}
            rows={7}
            placeholder="粘贴网页复制文本、聊天复制的客户信息或采购询价等杂乱文本"
          />
          <Space wrap>
            <Select
              value={aiSource}
              onChange={setAiSource}
              style={{ width: 170 }}
              options={[...SOURCES, '海外采购商抓取', 'AI清洗'].map((item) => ({ value: item, label: item }))}
            />
            <Button onClick={fillOverseasSample}>填入海外采购商样例</Button>
            <Button type="primary" loading={aiLoading} icon={<RobotOutlined />} onClick={runAiExtract}>
              AI 提取并查重
            </Button>
          </Space>
          {aiLoading ? <div className="muted">DeepSeek 正在识别公司、国家、行业、标签并检查重复...</div> : null}
          {aiResult ? (
            <>
              {aiResult.duplicates.length ? (
                <Alert
                  type="warning"
                  showIcon
                  message={`AI 识别到 ${aiResult.duplicates.length} 条疑似重复客户`}
                  description={aiResult.duplicates.map((item) => `${item.company_name}：${item.reason}`).join('；')}
                />
              ) : (
                <Alert type="success" showIcon message="AI 未发现重复客户，可保存到线索池" />
              )}
              <div className="panel" style={{ marginBottom: 0 }}>
                <div className="panel-title">AI 提取结果</div>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <div>
                    <strong>{aiResult.preview.company_name}</strong> · {aiResult.preview.country || '国家未知'} · {aiResult.preview.industry || '行业未知'}
                  </div>
                  <div className="muted">
                    {aiResult.preview.contact_name} {aiResult.preview.phone} {aiResult.preview.email}
                  </div>
                  <Space wrap>
                    {aiResult.preview.tags.map((tag) => (
                      <Tag key={tag}>{tag}</Tag>
                    ))}
                  </Space>
                  <div className="muted">{aiResult.preview.note}</div>
                  <Button type="primary" onClick={() => openCreateWithPreview(aiResult.preview)} disabled={aiResult.duplicates.length > 0}>
                    保存到线索池
                  </Button>
                  {aiResult.duplicates.length ? <div className="muted">重复线索建议在现有记录中合并，不重复入库。</div> : null}
                </Space>
              </div>
            </>
          ) : null}
        </Space>
      </Modal>

      <Modal
        title={editing ? '编辑线索' : '新建线索'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={saveLead}
        width={640}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="company_name" label="公司名称" rules={[{ required: true, message: '请输入公司名称' }]}>
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item name="contact_name" label="联系人">
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item name="country" label="国家 / 地区">
              <Input placeholder="例如：德国" />
            </Form.Item>
            <Form.Item name="industry" label="行业">
              <Input placeholder="例如：家居用品进口" />
            </Form.Item>
            <Form.Item name="phone" label="手机号">
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item name="email" label="邮箱">
              <Input placeholder="请输入" />
            </Form.Item>
            <Form.Item name="source" label="来源" initialValue="手动录入">
              <Select options={SOURCES.map((item) => ({ value: item, label: item }))} />
            </Form.Item>
            <Form.Item name="tags" label="标签">
              <Select mode="tags" placeholder="回车添加标签" tokenSeparators={[',', '，']} />
            </Form.Item>
            <Form.Item name="status" label="状态" initialValue="new">
              <Select options={LEAD_STATUS.map((item) => ({ value: item.value, label: item.label }))} />
            </Form.Item>
            <Form.Item name="note" label="备注">
              <Input placeholder="客户背景或关注点" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title="批量分配线索"
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        onOk={() => batch('assign', selectedIds, assignOwner)}
        width={420}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择接收销售"
          value={assignOwner}
          onChange={setAssignOwner}
          options={[
            { value: 'u_a', label: '王销售A' },
            { value: 'u_b', label: '陈销售B' },
            ...(user?.role === 'manager' ? [{ value: 'u_manager', label: '销售主管' }] : []),
          ]}
        />
      </Modal>
    </div>
  );
}
