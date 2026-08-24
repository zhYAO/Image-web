import { connection } from 'next/server';

import { ClientWorkspace } from './client-workspace';

export default async function HomePage() {
  await connection();
  return <ClientWorkspace />;
}
