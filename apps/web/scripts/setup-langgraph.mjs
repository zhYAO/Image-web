import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const connectionString = process.env.SUPABASE_DB_URL?.trim();
if (!connectionString) {
  throw new Error('SUPABASE_DB_URL is required. Use the private pooler URL; never expose it to the browser.');
}

let protocol;
try {
  protocol = new URL(connectionString).protocol;
} catch {
  throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL connection string.');
}
if (protocol !== 'postgres:' && protocol !== 'postgresql:') {
  throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string.');
}

const checkpointer = PostgresSaver.fromConnString(connectionString, { schema: 'langgraph' });
try {
  await checkpointer.setup();
  console.log('LangGraph checkpoint schema is initialized.');
} finally {
  await checkpointer.end();
}
