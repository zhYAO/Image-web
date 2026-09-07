import { OFFICIAL_SKILLS } from '@zimage/domain';
import Link from 'next/link';
import styles from './skills.module.css';

export default function SkillsPage() {
  return <main className={styles.page}>
    <nav><Link href="/">ZImage 工作区</Link><Link href="/login">登录</Link></nav>
    <p className={styles.eyebrow}>ZImage · 中国大陆公开 Beta</p>
    <h1>用对话完成商品图片创作</h1>
    <p>选择一个官方 Skill，用自然语言和参考图表达想法。发送前查看方案，信息不足时助手会追问。</p>
    <div className={styles.grid}>{OFFICIAL_SKILLS.map((skill) => <article key={skill.id}>
      <span aria-hidden className={styles.icon}>{skill.icon}</span>
      <h2>{skill.name}</h2><p>{skill.description}</p>
      <Link href={`/skills/${skill.id}`}>了解{skill.name} →</Link>
    </article>)}</div>
    <p className={styles.note}>Beta 尚非生产就绪。生成结果需人工核验；真实图片质量与公开发布仍有独立验收门禁。</p>
  </main>;
}
