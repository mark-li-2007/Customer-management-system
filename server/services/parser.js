export function parseEmailText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const parsed = { subject: '', from: '', date: '', body: '', type: 'email' };
  let inBody = false;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const fromMatch = trimmed.match(/^(?:发件人|From)\s*[:：]\s*(.+)$/i);
    const subjectMatch = trimmed.match(/^(?:主题|Subject)\s*[:：]\s*(.+)$/i);
    const dateMatch = trimmed.match(/^(?:时间|日期|Date)\s*[:：]\s*(.+)$/i);

    if (fromMatch && !parsed.from) parsed.from = fromMatch[1].trim();
    else if (subjectMatch && !parsed.subject) parsed.subject = subjectMatch[1].trim();
    else if (dateMatch && !parsed.date) parsed.date = dateMatch[1].trim();
    else if (/^(收件人|To|抄送|Cc|密送|Bcc)\s*[:：]/i.test(trimmed)) return;
    else if (trimmed === '') {
      inBody = true;
    } else if (inBody) {
      parsed.body += `${trimmed}\n`;
    } else if (!fromMatch && !subjectMatch && !dateMatch && index > 3 && !parsed.body) {
      parsed.body += `${trimmed}\n`;
    }
  });

  parsed.body = parsed.body.trim();
  return parsed;
}

export function parseChatText(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const messages = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const match = trimmed.match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{1,2}:\d{2})?)?\s*([^:：\s][^:：]{0,16})[:：]\s*(.*)$/);
    if (!match) return;
    const [, dateTime, sender, content] = match;
    messages.push({
      dateTime: dateTime ?? '',
      sender: sender.trim(),
      content: content.trim(),
    });
  });

  return { type: 'social', messages };
}

export function extractEmails(text) {
  return String(text ?? '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
}

export function extractPhones(text) {
  return String(text ?? '').match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/g) ?? [];
}
