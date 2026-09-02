import { chatText, parseJsonText, todayPromptText } from './ai.js';

async function jsonChat(system, user, options) {
  return parseJsonText(await chatText(system, user, options));
}

export async function extractLeadWithAI(rawText) {
  const system = [
    '你是 CRM 线索清洗智能体，输入可能是一段杂乱复制的网页文本、聊天记录或采购信息。',
    '请自动提取结构化线索字段。',
    '只输出 JSON，不要输出解释。字段：company_name, contact_name, phone, email, country, industry, tags, source_hint, note。',
    'tags 用于线索标签，例如 ["德国","采购","汽配"]。公司名或联系人无法确定时填空字符串，不要编造。',
  ].join('\n');
  const user = todayPromptText() + `\n原始文本：\n${rawText}`;
  return jsonChat(system, user);
}

export async function extractLeadBatchWithAI(texts, candidates) {
  const system = [
    '你是 CRM 海外采购商数据清洗智能体。',
    '输入是 crawler_items 数组，每项是一段杂乱网页或聊天文本，可能包含多家采购商。',
    '请输出 JSON：{"items":[{"raw_index":0,"company_name":"","contact_name":"","phone":"","email":"","country":"","industry":"","tags":[],"source_hint":"","note":""}]}',
    '另外判断 items 与 existing_candidates 是否重复，输出 "duplicates":[{"raw_index":0,"candidate_ids":["现有id"],"reason":"简短理由"}]。',
    '只有当某条目确实与现有候选重复时才加入 duplicates，且 candidate_ids 必须是非空数组；没有重复就不要出现在 duplicates 中。',
    '无法识别的条目仍输出一个空 company_name 对象。',
  ].join('\n');
  const user = JSON.stringify({ crawler_items: texts, existing_candidates: candidates });
  return jsonChat(system, user, { maxTokens: 3200 });
}

export async function checkDuplicateWithAI(candidate, candidates) {
  const input = {
    new: candidate,
    existing: candidates,
  };
  const system = [
    '你是 CRM 客户查重智能体。',
    '判断新线索与候选列表中的公司是否是同一家客户。',
    '相似公司名、同联系人、同电话、同邮箱、同国家且主营相近都视为重复。',
    '只输出 JSON：{"duplicates":[{"id":"候选id","reason":"简短中文理由","confidence":0.9}]}。',
    '不重复时 duplicates 为空数组。',
  ].join('\n');
  const user = JSON.stringify(input);
  return jsonChat(system, user);
}

export async function processCustomerChatWithAI({ customer, contacts, opportunities, text }) {
  const system = [
    '你是 CRM 销售助手，服务对象是销售和管理者，不直接回复海外客户。',
    '读取销售粘贴的一段客户沟通内容，自动完成内部客户管理动作。',
    '输出 JSON，字段说明：',
    '1. log：自动生成的中文跟进日志，格式为“YYYY-MM-DD 沟通：客户关键诉求与状态，意向程度，建议下一步动作”。',
    '2. customer_updates：从对话中提取 country, industry, product_interest, budget(数字，无法确定给null), intent_level("高"|"中"|"低"|""), description, next_follow_at(YYYY-MM-DD或null)。不要编造。',
    '3. opportunity：null 或对象。客户出现问价、报价、采购需求时创建或更新商机；不是每次聊天都创建。',
    'opportunity 字段：action("create"或"update"), id(update时给已有商机id，否则null), title, product, stage("contact"|"quote"|"negotiation"|"closed_won"|"closed_lost"), budget, probability(0-100数字), expected_close_date(YYYY-MM-DD或null), note。',
    '已有商机供参考；如果客户这次提的是不同产品采购，允许为同一客户新建第二个商机。',
    '只输出 JSON。',
  ].join('\n');
  const user = JSON.stringify({
    today: todayPromptText(),
    customer: {
      id: customer.id,
      company_name: customer.company_name,
      country: customer.country,
      industry: customer.industry,
      product_interest: customer.product_interest,
      budget: customer.budget,
      intent_level: customer.intent_level,
      contacts,
    },
    existing_opportunities: opportunities.map((item) => ({
      id: item.id,
      title: item.title,
      product: item.product,
      stage: item.stage,
      probability: item.progress,
      expected_close_date: item.expected_close_date,
    })),
    customer_chat_text: text,
  });
  return jsonChat(system, user, { maxTokens: 2600 });
}

export async function parseTaskWithAI(text, customers) {
  const system = [
    '你是 CRM 日程助手，读取销售的一句话，把它转成日历待办。',
    '例如“下周三跟进德国客户 ABC，给他发新报价”应解析出：title 为跟进动作，due_date 为下一个符合描述的日期。',
    '只输出 JSON：{"title":"任务标题","due_date":"YYYY-MM-DD","due_time":"HH:mm或null","priority":"high|medium|low","related_customer_id":"候选客户id或null","note":"任务备注","reason":"日期推算说明"}。',
    '不要编造与客户不匹配的关联。',
  ].join('\n');
  const user = JSON.stringify({
    today: todayPromptText(),
    text,
    customers: customers.map((item) => ({ id: item.id, company_name: item.company_name, country: item.country })),
  });
  return jsonChat(system, user, { maxTokens: 1200 });
}

export async function generateDailyReportWithAI({ userName, date, activities, tasks }) {
  const system = [
    '你是 CRM 工作日报助手，为销售生成简洁工作日报。',
    '只输出 JSON：{"content":"今日完成工作摘要，列出客户和事项","plan":"明日工作计划","blockers":"遇到的问题，没有则空字符串"}。',
    '基于下方真实记录生成，不要编造客户或工作。',
  ].join('\n');
  const user = JSON.stringify({ userName, date, activities, tasks });
  return jsonChat(system, user, { maxTokens: 1800 });
}
