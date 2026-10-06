'use client';

import { COMMERCE_PLATFORMS, COMMERCE_PRIMARY_SCENE_IDS, COMMERCE_SCENES, COMMERCE_TEMPLATES, type CommerceScene } from '@zimage/domain';
import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { commerceHref } from '@/features/workspace/workspace-route';
import { CommerceHeader, CommerceNav } from './CommerceChrome';
import { commerceExampleForScene } from './commerce-examples';
import styles from './meitu.module.css';

export function CommerceCatalogue() {
  const [platform, setPlatform] = useState('all');
  const [search, setSearch] = useState('');
  const featured = COMMERCE_PRIMARY_SCENE_IDS.map(id => COMMERCE_SCENES.find(scene => scene.id === id)!).filter(scene => `${scene.name}${scene.description}`.includes(search));
  const extra = COMMERCE_SCENES.filter(scene => !COMMERCE_PRIMARY_SCENE_IDS.some(id => id === scene.id));
  const launch = (scene: CommerceScene, template?: string) => commerceHref(scene, platform, template);
  return <div className={`${styles.theme} ${styles.catalogue}`}><CommerceHeader /><div className={styles.catalogueBody}><CommerceNav /><main className={styles.catalogueMain}>
    <h1>电商生图</h1><p>从一张商品图开始，让创意成为生意。</p>
    <div className={styles.catalogueFilter} aria-label="平台筛选"><input className={styles.catalogueSearch} aria-label="搜索电商工具" placeholder="搜索你需要的工具" value={search} onChange={event => setSearch(event.target.value)} />{[{ id: 'all', name: '全部平台' }, ...COMMERCE_PLATFORMS].map(item => <button key={item.id} aria-pressed={platform === item.id} onClick={() => setPlatform(item.id)}>{item.name}</button>)}</div>
    <div className={styles.catalogueTools}>{featured.map(scene => <Link className={styles.toolCard} key={scene.id} href={launch(scene.id)} aria-label={`开始${scene.name} →`}><Image src={commerceExampleForScene(scene.id)} width={640} height={480} sizes="(min-width: 1450px) 17vw, 27vw" alt={`${scene.name}原创示例`} /><div><strong>{scene.name}</strong><p>{scene.description}</p><small>{scene.id === 'batch' ? '最多 20 个商品任务' : scene.id === 'clone' ? '最多 20 张参考图' : scene.id === 'detail' ? '16 个可选模块' : scene.id === 'product-set' ? '默认 7 张 · 最多 20 张' : '每次最多 4 张'}</small></div></Link>)}</div>
    {!featured.length && <p role="status">没有找到匹配的工具。</p>}
    <h2>更多创作</h2><div className={styles.legacyLinks}>{extra.map(scene => <Link href={launch(scene.id)} key={scene.id}>{scene.name} →</Link>)}</div>
    <details><summary>原创风格方向</summary><div className={styles.legacyLinks}>{COMMERCE_TEMPLATES.filter(t => t.published).map(t => <Link key={t.id} href={launch(t.visual.scenes[0]! as CommerceScene, t.id)} aria-label={`使用${t.name}模板`} title={t.guidance}>{t.name} →</Link>)}</div></details>
    <p className={styles.exampleCaption}>原创 AI 示例 · 以实际生成效果为准。商品原图最多 6 张，复刻参考图最多 20 张，每张不超过 10 MB。</p>
  </main></div></div>;
}
