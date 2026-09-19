import { connection } from 'next/server';


export default async function HomePage() {
  await connection();
  return null;
}
