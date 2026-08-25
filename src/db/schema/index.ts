/**
 * Single entry point for the Drizzle schema. Every table is exported from here
 * so drizzle-kit and the application agree on one source of truth.
 */
export * from './identity';
export * from './project';
export * from './work';
export * from './repository';
export * from './gateway';
export * from './objectives';
