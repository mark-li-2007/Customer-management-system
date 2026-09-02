import { describe, expect, it } from 'vitest';
import { extractEmails, extractPhones, parseChatText, parseEmailText } from '../server/services/parser.js';

describe('自动抓取文本解析', () => {
  it('解析中文邮件头与正文', () => {
    const email = `
发件人：陈晨 <chenchen@xinrui.cn>
主题：关于方案评审时间
日期：2026-09-01 14:30

王经理您好，
我们计划下周二下午做内部评审，请提前准备演示环境。
`;
    const parsed = parseEmailText(email);
    expect(parsed.from).toContain('chenchen@xinrui.cn');
    expect(parsed.subject).toBe('关于方案评审时间');
    expect(parsed.date).toBe('2026-09-01 14:30');
    expect(parsed.body).toContain('内部评审');
  });

  it('解析聊天记录为结构化消息', () => {
    const chat = `
2026-09-01 10:12 陈晨：报价单已收到，正在走流程。
2026-09-01 15:40 王销售A：好的，需要我补充资料随时联系。
`;
    const parsed = parseChatText(chat);
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0].sender).toBe('陈晨');
    expect(parsed.messages[0].content).toContain('报价单');
  });

  it('提取联系方式', () => {
    const text = '电话 13800138000，邮箱 chenchen@xinrui.cn，备用 13612345678';
    expect(extractPhones(text)).toEqual(['13800138000', '13612345678']);
    expect(extractEmails(text)).toEqual(['chenchen@xinrui.cn']);
  });
});
