import pino, { type DestinationStream, type Logger } from 'pino';

const sensitiveFields = [
  'apiKey',
  'email',
  'imageUrl',
  'invitationCode',
  'otp',
  'prompt',
  'providerRawResponse',
  'secret',
  'serviceRoleKey',
  'smtpPassword',
] as const;

const redactPaths = sensitiveFields.flatMap((field) => [field, `*.${field}`]);

export type CreateLoggerOptions = {
  destination?: DestinationStream;
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  service: string;
};

export const createLogger = ({ destination, level, service }: CreateLoggerOptions): Logger => {
  const options = {
    base: { service },
    level,
    redact: {
      censor: '[REDACTED]',
      paths: redactPaths,
    },
  } as const;

  return destination === undefined ? pino(options) : pino(options, destination);
};

