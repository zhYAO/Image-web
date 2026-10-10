export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  return Response.json({ code: 'gone', message: '批量发起已停用，历史任务仍可查看。' }, { status: 410, headers: { 'cache-control': 'no-store' } });
}
