const reasons: Record<string, string> = {
  legal_unavailable: '注册暂未开放，请等待服务条款确认后再试。',
  too_short: '密码至少需要 8 个字符。',
  too_long: '密码过长，请缩短后重试。',
  common: '密码过于常见，请使用更安全的密码。',
  breached: '该密码曾出现在泄露记录中，请更换密码。',
};

export function authFeedback(result: { reason?: string; message?: string }, fallback: string) {
  return (result.reason && reasons[result.reason]) || result.message || fallback;
}
