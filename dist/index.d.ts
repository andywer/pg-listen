import TypedEventEmitter from "typed-emitter";
import pg = require("pg");
export interface PgParsedNotification {
    processId: number;
    channel: string;
    payload?: any;
}
interface PgListenEvents {
    connected: () => void;
    error: (error: Error) => void;
    notification: (notification: PgParsedNotification) => void;
    reconnect: (attempt: number) => void;
}
declare type EventsToEmitterHandlers<Events extends Record<string, any>> = {
    [channelName in keyof Events]: (payload: Events[channelName]) => void;
};
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
    parse?: (serialized: string) => any;
    /**
     * Custom function to control how the payload data is stringified on `.notify()`.
     * Use together with the `parse` option. Defaults to `JSON.stringify`.
     */
    serialize?: (data: any) => string;
}
export interface Subscriber<Events extends Record<string, any> = {
    [channel: string]: any;
}> {
    /** Emits events: "error", "notification" & "redirect" */
    events: TypedEventEmitter<PgListenEvents>;
    /** For convenience: Subscribe to distinct notifications here, event name = channel name */
    notifications: TypedEventEmitter<EventsToEmitterHandlers<Events>>;
    /** Don't forget to call this asyncronous method before doing your thing */
    connect(): Promise<void>;
    close(): Promise<void>;
    getSubscribedChannels(): string[];
    listenTo(channelName: string): Promise<pg.QueryResult> | undefined;
    notify<EventName extends keyof Events>(channelName: any extends Events[EventName] ? EventName : void extends Events[EventName] ? never : EventName, payload: Events[EventName] extends void ? never : Events[EventName]): Promise<pg.QueryResult>;
    notify<EventName extends keyof Events>(channelName: void extends Events[EventName] ? EventName : never): Promise<pg.QueryResult>;
    unlisten(channelName: string): Promise<pg.QueryResult> | undefined;
    unlistenAll(): Promise<pg.QueryResult>;
}
declare function createPostgresSubscriber<Events extends Record<string, any> = {
    [channel: string]: any;
}>(connectionConfig?: pg.ClientConfig, options?: Options): Subscriber<Events>;
export default createPostgresSubscriber;
