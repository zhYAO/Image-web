import type { ApiError } from '@zimage/domain';

export class ApiRouteError extends Error {
  readonly code: ApiError['code'];
  readonly details?: ApiError['details'];
  readonly retryable: boolean;
  readonly status: number;

  constructor(input: {
    code: ApiError['code'];
    details?: ApiError['details'];
    message: string;
    retryable: boolean;
    status: number;
  }) {
    super(input.message);
    this.name = 'ApiRouteError';
    this.code = input.code;
    this.details = input.details;
    this.retryable = input.retryable;
    this.status = input.status;
  }
}
