import pino from 'pino';
import { config } from './config';

/** Shared pino logger for the service, level configurable via `LOG_LEVEL`. */
export const logger = pino({ level: config.LOG_LEVEL });
