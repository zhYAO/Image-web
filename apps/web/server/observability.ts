export function reportServerError(_error: unknown, input: {
  correlationId: string;
  operation: string;
}): void {
  console.error({
    event: 'server_operation_failed',
    correlation_id: input.correlationId,
    operation: input.operation,
  });
}
