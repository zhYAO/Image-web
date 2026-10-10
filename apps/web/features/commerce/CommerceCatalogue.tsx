'use client';

import { COMMERCE_PRIMARY_SCENE_IDS, COMMERCE_SCENES } from '@zimage/domain';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { commerceHref } from '@/features/workspace/workspace-route';
import { commerceExampleForScene } from './commerce-examples';
import cards from '@/features/workspace/home-commerce-carousel.module.css';
import styles from './catalogue.module.css';

export function CommerceCatalogue() {
  const featured = COMMERCE_PRIMARY_SCENE_IDS.map(id => COMMERCE_SCENES.find(scene => scene.id === id)!);
  return <section className={styles.catalogue} aria-label="电商工具目录">
    <div className={styles.content}>
      <h1>电商生图</h1><p className={styles.subtitle}>从一张商品图开始，让创意成为生意。</p>
      <div className={styles.tools}>{featured.map(scene => <Link className={cards.card} key={scene.id} href={commerceHref(scene.id)} aria-label={`开始${scene.name} →`}>
        <div className={cards.cover}><Image src={commerceExampleForScene(scene.id)} width={640} height={480} sizes="(max-width: 767px) 85vw, (max-width: 1150px) 40vw, 280px" alt={`${scene.name}原创示例`} /></div>
        <div className={cards.caption}><span>{scene.name}</span><ArrowUpRight size={17} aria-hidden /></div>
        <div className={styles.description}><p>{scene.description}</p><small>{scene.id === 'apparel-catalog' ? '整套 11–30 张 · 固定排版' : scene.id === 'clone' ? '最多 20 张参考图' : scene.id === 'detail' ? '16 个可选模块' : scene.id === 'product-set' ? '默认 7 张 · 最多 20 张' : '每次最多 4 张'}</small></div>
      </Link>)}</div>
      <p className={styles.caption}>原创 AI 示例 · 以实际生成效果为准。</p>
    </div>
  </section>;
}
