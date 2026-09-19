import { notFound } from 'next/navigation';
import { commerceSceneSchema } from '@zimage/domain';

export default async function CommercePage({ params }: { params: Promise<{ scene: string }> }) {
  if (!commerceSceneSchema.safeParse((await params).scene).success) notFound();
  // The shared layout owns the single persistent workspace runtime.
  return null;
}
