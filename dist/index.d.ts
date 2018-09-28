import pg from "pg";
import { TypedEventEmitter } from "./event-emitter";
export interface PgParsedNotification {
    processId: number;
    channel: string;
    payload?: any;
}
interface PgListenEvents {
    error: (error: Error) => void;
    fatalError: (error: Error) => void;
    notification: (notification: PgParsedNotification) => void;
    reconnect: (attempt: number) => void;
}
interface NotificationEvents {
    [channelName: string]: (payload: any) => void;
}
export interface Options {
    /**
     * Using native PG client? Defaults to false.
     */
    native?: boolean;
    /**
     * Interval in ms to run a trivial query on the DB to see if
     * the database connection still works.
     * Defaults to 60s.
     */
    paranoidChecking?: number | false;
    /**
     * How much time to wait between reconnection attempts (if failed).
     * Defaults to 500 ms.
     */
    retryInterval?: number;
    /**
     * How many attempts to reconnect after connection loss.
     * Defaults to no limit, but a default retryTimeout is set.
     */
    retryLimit?: number;
    /**
     * Timeout in ms after which to stop retrying and just fail. Defaults to 3000 ms.
     */
    retryTimeout?: number;
}
declare function createPostgresNotifier(connectionConfig?: pg.ConnectionConfig, options?: Options): {
    /** Emits events: "error", "fatalError", "notification" & "redirect" */
    events: TypedEventEmitter<PgListenEvents>;
    /** For convenience: Subscribe to distinct notifications here, event name = channel name */
    notifications: TypedEventEmitter<NotificationEvents>;
    close(): Promise<void>;
    getSubscribedChannels(): string[];
    listenTo(channelName: string): Promise<pg.QueryResult> | undefined;
    notify(channelName: string, payload: any): Promise<pg.QueryResult>;
    unlisten(channelName: string): Promise<pg.QueryResult> | undefined;
    unlistenAll(): Promise<pg.QueryResult>;
};
export default createPostgresNotifier;
