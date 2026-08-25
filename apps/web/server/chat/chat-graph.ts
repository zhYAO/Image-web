import { Annotation, START, StateGraph } from '@langchain/langgraph';
import type { ChatEvent } from '@zimage/domain';

import { createChatTurnRunner } from './chat-service';

type Runner = ReturnType<typeof createChatTurnRunner>;
type RunnerInput = Parameters<Runner>[0];

const GraphState = Annotation.Root({
  completed: Annotation<boolean>({ default: () => false, reducer: (_, update) => update }),
  input: Annotation<RunnerInput>(),
});

// The single-node `START → chat → END` graph does not need langgraph
// checkpointing: there is no human-in-the-loop, no resumable stream, and no
// branching. Persisting a PostgresSaver on every chat turn was paying the
// cost of an extra pg.Pool (and Supavisor's transaction-mode quirks) for
// nothing useful. When a future feature actually needs resumption — interrupt
// + resume, time-travel, etc. — wire `PostgresSaver.fromConnString` back here
// with `keepAlive: true` on its pool.
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
    .compile();
  await graph.invoke(
    { completed: false, input },
    { configurable: { thread_id: input.sessionId } },
  );
}
