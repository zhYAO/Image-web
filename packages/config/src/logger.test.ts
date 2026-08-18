import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from './logger.js';

const readLogLine = async (stream: PassThrough): Promise<Record<string, unknown>> =>
  await new Promise((resolve, reject) => {
    stream.once('data', (chunk: Buffer) => {
      try {
        resolve(JSON.parse(chunk.toString()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });

describe('createLogger', () => {
  it('redacts sensitive top-level and nested values while retaining correlation identifiers', async () => {
    const destination = new PassThrough();
    const linePromise = readLogLine(destination);
    const logger = createLogger({ destination, level: 'info', service: 'test' });

    logger.info({
      apiKey: 'local-api-key-placeholder',
      email: 'person@example.invalid',
      imageUrl: 'https://example.invalid/private-image',
      invitationCode: 'INVITE-PLACEHOLDER',
      nested: {
        otp: '000000',
        prompt: 'private prompt placeholder',
        providerRawResponse: { result: 'private provider payload' },
      },
      requestId: 'request-1',
      taskId: 'task-1',
      turnId: 'turn-1',
    }, 'foundation-event');

    const line = await linePromise;

    expect(line).toMatchObject({
      apiKey: '[REDACTED]',
      email: '[REDACTED]',
      imageUrl: '[REDACTED]',
      invitationCode: '[REDACTED]',
      nested: {
        otp: '[REDACTED]',
        prompt: '[REDACTED]',
        providerRawResponse: '[REDACTED]',
      },
      requestId: 'request-1',
      service: 'test',
      taskId: 'task-1',
      turnId: 'turn-1',
    });
  });
});

