import { Suspense } from 'react';
import { VerifyPanel } from '../../../features/auth/VerifyPanel';
export default function VerifyPage() { return <Suspense fallback={<p>正在加载…</p>}><VerifyPanel /></Suspense>; }
