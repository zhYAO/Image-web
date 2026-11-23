export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startLifecycleControl } = await import('./server/lifecycle/control-server');
    await startLifecycleControl();
  }
}
