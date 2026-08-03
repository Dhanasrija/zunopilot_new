import winston from 'winston';
import { env } from './env.js';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = printf((info) => {
  const { level, message, timestamp: ts, stack, ...meta } = info as typeof info & {
    timestamp?: string;
    stack?: string;
  };
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${stack || message}${metaStr}`;
});

export const logger = winston.createLogger({
  level: env.logLevel,
  format: env.nodeEnv === 'production'
    ? combine(timestamp(), errors({ stack: true }), json())
    : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), errors({ stack: true }), devFormat),
  transports: [new winston.transports.Console()],
  // A test run should be silent unless something actually asks for output.
  silent: env.isTest && process.env.LOG_LEVEL !== 'debug',
});

export const httpLoggerStream = {
  write: (message: string) => logger.info(message.trim()),
};

/**
 * Fields every conversation-engine log line carries, so a single message can be
 * traced from webhook through routing to node execution. Never put message text
 * or contact details in here — see the privacy note in the README.
 */
export interface LogContext {
  tenantId?: string;
  assistantId?: string;
  conversationId?: string;
  contactId?: string;
  messageId?: string;
  workflowId?: string;
  workflowInstanceId?: string;
  nodeExecutionId?: string;
  nodeId?: string;
  nodeType?: string;
  jobId?: string;
  routingSource?: string;
  decision?: string;
  latencyMs?: number;
}

/**
 * A logger bound to a fixed context. Child loggers merge their metadata into
 * every call, which keeps call sites from re-listing the same six ids.
 */
export const withContext = (context: LogContext) => logger.child(context);

export type ContextLogger = ReturnType<typeof withContext>;
