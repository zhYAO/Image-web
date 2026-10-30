import { Component, type ReactNode } from 'react';

/** A failed UI chunk never triggers an automatic generation, upload or POST retry. */
export class RuntimeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="glass-page"><section className="glass-card glass-form" role="alert"><h1>暂时无法打开创作空间</h1>
      <p>请保留已有请求记录，稍后重新打开。</p>
      <button type="button" onClick={() => window.location.reload()}>重新打开</button>
      <button type="button" onClick={() => window.location.assign(new URL('/home', window.location.href).href)}>返回首页</button>
    </section></main>;
  }
}
