import Link from '../platform/link';
import type { ReactNode } from 'react';
import { BrandMark } from '../../../web/features/brand/BrandMark';
import { ArrowUpRight } from 'lucide-react';

/** Preserve the current unapproved legal state; this text cannot enable registration. */
export function LegalPage({ kind, creditBalance }: { kind: 'terms' | 'privacy'; creditBalance?: ReactNode }) {
  return <main className="glass-page">
    <nav className="glass-site-nav" aria-label="网站导航"><Link className="glass-brand" href="/"><BrandMark />ZImage<span>创作空间</span></Link><Link href="/create">探索电商创作 <ArrowUpRight size={15} aria-hidden /></Link>{creditBalance}</nav>
    <article className="glass-card glass-prose">
      <p className="glass-kicker">ZIMAGE · {kind === 'terms' ? '服务条款' : '隐私'}</p>
      <h1>{kind === 'terms' ? '服务条款' : '隐私政策'}（未批准草案）</h1>
      <p>本文本尚未经过正式审批，仅用于隔离开发与测试，不能作为公开发布版本。</p>
      {kind === 'terms'
        ? <p>拟议范围：中国大陆公开 Beta，产品尚未达到生产就绪；切换正式账号后匿名数据将无通知永久删除；账号注销会立即停止访问并进入后台清理。</p>
        : <p>拟议范围：邮箱账号资料、创作会话与生成资产；日志不得记录邮箱、密码、令牌或完整提示词。切换正式账号时匿名内容会永久删除。</p>}
    </article>
  </main>;
}
