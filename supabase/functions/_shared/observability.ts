interface WorkerErrorContext {
  correlationId?: string;
  jobId?: string;
  operation: string;
  status?: string;
}

export async function captureWorkerException(_error: unknown, context: WorkerErrorContext) {
  console.error({ event: 'worker_operation_failed', operation: context.operation,
    correlation_id: context.correlationId, job_id: context.jobId, status: context.status });
}
