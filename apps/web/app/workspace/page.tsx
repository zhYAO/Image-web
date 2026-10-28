import { connection } from 'next/server';

/** The shared WorkspaceHost owns the sole editor runtime. */
export default async function WorkspacePage() {
  await connection();
  return null;
}
