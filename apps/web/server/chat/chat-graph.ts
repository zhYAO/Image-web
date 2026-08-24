import { Annotation, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import type { ChatEvent } from '@zimage/domain';

import { createChatTurnRunner } from './chat-service';

type Runner = ReturnType<typeof createChatTurnRunner>;
type RunnerInput = Parameters<Runner>[0];

const GraphState = Annotation.Root({
  completed: Annotation<boolean>({ default: () => false, reducer: (_, update) => update }),
  input: Annotation<RunnerInput>(),
});

let checkpointer: PostgresSaver | undefined;

function getCheckpointer() {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) throw new Error('SUPABASE_DB_URL is required for the chat checkpointer.');
  checkpointer ??= PostgresSaver.fromConnString(connectionString, { schema: 'langgraph' });
  return checkpointer;
}

export async function executeChatGraph(
  input: RunnerInput,
  runner: Runner,
  emit: (event: ChatEvent) => Promise<void>,
) {
  const graph = new StateGraph(GraphState)
    .addNode('chat', async (state) => {
      for await (const event of runner(state.input)) await emit(event);
      return { completed: true };
    })
    .addEdge(START, 'chat')
    .compile({ checkpointer: getCheckpointer() });

  await graph.invoke(
    { completed: false, input },
    { configurable: { checkpoint_ns: 'chat', thread_id: input.sessionId } },
  );
}
