import { OFFICIAL_SKILLS } from '@zimage/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import styles from '../skills.module.css';

export default async function SkillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const skill = OFFICIAL_SKILLS.find((item) => item.id === id);
  if (!skill) notFound();
  return <main className={styles.page}>
    <nav><Link href="/skills">← 官方 Skill</Link><Link href="/">工作区</Link></nav>
    <p className={styles.eyebrow}>官方 Skill · v{skill.version} · 中国大陆 Beta</p>
    <h1>{skill.name}</h1><p>{skill.description}</p>
    <section className={styles.detail}>
      <h2>适用场景与产出</h2><p>{skill.output}</p>
      <h2>建议提供</h2><p>{skill.suggestedInput}</p>
      <h2>默认方案</h2><p>{skill.defaults}</p><p>可在发送前修改，信息足够后发送即执行一次。</p>
      <h2>使用限制</h2><p>{skill.limitations}</p>
    </section>
    <Link className={styles.primary} href={`/?skill=${skill.id}&new=1`}>立即使用</Link>
    <p className={styles.note}>未登录时先完成登录，再进入预选此 Skill 的新会话。</p>
  </main>;
}
