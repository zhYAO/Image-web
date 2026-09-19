import Link from 'next/link';

export function WorkspaceLoading({ error, onRetry }: { error?: string; onRetry?: () => void } = {}) {
  return (
    <main
      className="workspace-loading"
      aria-label="ZImage 正在载入"
      aria-busy={!error}
    >
      <aside>
        <strong>ZImage</strong>
        <span>灵感，让创作发生</span>
      </aside>
      <section>
        <header>创作空间</header>
        {error ? <div role="alert"><p>暂时无法打开创作空间</p><p>{error}</p><button onClick={onRetry}>重新打开</button><Link href="/create">返回电商创作</Link></div> : <div role="status">
          <span className="loading-orbit" />
          正在准备创作空间…
        </div>}
      </section>
    </main>
  );
}
