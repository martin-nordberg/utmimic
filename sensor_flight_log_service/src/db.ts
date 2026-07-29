import { SQL } from 'bun';
import { config } from './config';

/** Shared pooled Postgres client for the service, backed by Bun's built-in SQL driver. */
export const sql = new SQL(config.DATABASE_URL);
