import { describe, expect, it } from 'vitest';
import { parseJsonText, todayPromptText } from '../server/services/ai.js';

describe('AI 工具函数', () => {
  it('解析包含 Markdown 代码块的 JSON 响应', () => {
    const input = '```json\n{"company_name":"ABC GmbH","country":"德国"}\n```';
    expect(parseJsonText(input)).toEqual({ company_name: 'ABC GmbH', country: '德国' });
  });

  it('解析嵌套 JSON 响应', () => {
    const input = '解释文字\n{"duplicates":[{"id":"c1","reason":"同一家公司"}]}';
    expect(parseJsonText(input)).toEqual({ duplicates: [{ id: 'c1', reason: '同一家公司' }] });
  });

  it('生成包含当前日期的提示前缀', () => {
    const prefix = todayPromptText();
    expect(prefix).toContain('今天是');
    expect(prefix).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
