// Reject this retired entry before a streamed layout can commit HTTP 200.
// Historical batch reads remain on their authenticated API/session routes.
export function GET() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
}
