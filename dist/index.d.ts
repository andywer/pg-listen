/// <reference types="node" resolution-mode="require"/>
import { EventEmitter } from 'node:events';
import pg from 'pg';
export interface Options {
  /**
   * Using native PG client? Defaults to false.
   */
  native?: boolean;
  /**
   * Interval in ms to run a trivial query on the DB to see if
   * the database connection still works.
   * Defaults to 30s.
   */
  paranoidChecking?: number | false;
  /**
   * How much time to wait between reconnection attempts (if failed).
   * Can also be a callback returning a delay in milliseconds.
   * Defaults to 500 ms.
   */
  retryInterval?: number | ((attempt: number) => number);
  /**
   * How many attempts to reconnect after connection loss.
   * Defaults to no limit, but a default retryTimeout is set.
   */
  retryLimit?: number;
  /**
   * Timeout in ms after which to stop retrying and just fail. Defaults to 3000 ms.
   */
  retryTimeout?: number;
  /**
   * Custom function to control how the payload data is stringified on `.notify()`.
   * Use together with the `serialize` option. Defaults to `JSON.parse`.
   */
  parse?: (serialized: string) => unknown;
  /**
   * Custom function to control how the payload data is stringified on `.notify()`.
   * Use together with the `parse` option. Defaults to `JSON.stringify`.
   */
  serialize?: (data: unknown) => string;
}
export interface Subscriber {
  /** Emits events: "error", "notification" & "redirect" */
  events: EventEmitter;
  /** For convenience: Subscribe to distinct notifications here, event name = channel name */
  notifications: EventEmitter;
  /** Don't forget to await this before doing anything with the Subscriber */
  connect(): Promise<void>;
  close(): Promise<void>;
  getSubscribedChannels(): string[];
  listenTo(channelName: string): Promise<pg.QueryResult> | undefined;
  notify(channelName: string, payload?: unknown): Promise<pg.QueryResult>;
  unlisten(channelName: string): Promise<pg.QueryResult> | undefined;
  unlistenAll(): Promise<pg.QueryResult>;
}
export declare const createSubscriber: (
  connectionConfig?: pg.ClientConfig,
  options?: Options,
) => Subscriber;
