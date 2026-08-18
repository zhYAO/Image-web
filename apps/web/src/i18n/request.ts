import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => ({
  locale: 'zh-CN',
  messages: (await import('../../messages/zh-CN.json')).default,
}));

