import createDebugLogger from "debug"
import EventEmitter from "events"
import format from "pg-format"
import TypedEventEmitter from "typed-emitter"

// Need to require `pg` like this to avoid ugly error message (see #15)
import pg = require("pg")

const connectionLogger = createDebugLogger("pg-listen:connection")
const notificationLogger = createDebugLogger("pg-listen:notification")
const paranoidLogger = createDebugLogger("pg-listen:paranoid")
const subscriptionLogger = createDebugLogger("pg-listen:subscription")

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

interface PgNotification {
  processId: number,
  channel: string,
  payload?: string
}

export interface PgParsedNotification {
  processId: number,
  channel: string,
  payload?: any
}

interface PgListenEvents {
  connected: () => void,
  error: (error: Error) => void,
  notification: (notification: PgParsedNotification) => void,
  reconnect: (attempt: number) => void
}

type EventsToEmitterHandlers<Events extends Record<string, any>> = {
  [channelName in keyof Events]: (payload: Events[channelName]) => void
}

export interface Options {
  /**
   * Using native PG client? Defaults to false.
   */
  native?: boolean

  /**
   * Interval in ms to run a trivial query on the DB to see if
   * the database connection still works.
   * Defaults to 30s.
   */
  paranoidChecking?: number | false

  /**
   * How much time to wait between reconnection attempts (if failed).
   * Defaults to 500 ms.
   */
  retryInterval?: number

  /**
   * How many attempts to reconnect after connection loss.
   * Defaults to no limit, but a default retryTimeout is set.
   */
  retryLimit?: number

  /**
   * Timeout in ms after which to stop retrying and just fail. Defaults to 3000 ms.
   */
  retryTimeout?: number

  /**
   * Custom function to control how the payload data is stringified on `.notify()`.
   * Use together with the `serialize` option. Defaults to `JSON.parse`.
   */
  parse?: (serialized: string) => any

  /**
   * Custom function to control how the payload data is stringified on `.notify()`.
   * Use together with the `parse` option. Defaults to `JSON.stringify`.
   */
  serialize?: (data: any) => string
}

function connect(connectionConfig: pg.ClientConfig | undefined, emitter: TypedEventEmitter<PgListenEvents>, options: Options) {
  connectionLogger("Creating PostgreSQL client for notification streaming")

  const { retryInterval = 500, retryLimit = Infinity, retryTimeout = 3000 } = options
  const effectiveConnectionConfig: pg.ClientConfig = { ...connectionConfig, keepAlive: true }

  const Client = options.native && pg.native ? pg.native.Client : pg.Client
  const dbClient = new Client(effectiveConnectionConfig)

  const reconnect = async (onAttempt: (attempt: number) => void): Promise<pg.Client> => {
    connectionLogger("Reconnecting to PostgreSQL for notification streaming")
    const startTime = Date.now()

    for (let attempt = 1; attempt < retryLimit || !retryLimit; attempt++) {
      connectionLogger(`PostgreSQL reconnection attempt #${attempt}...`)
      onAttempt(attempt)

      try {
        const newClient = new Client(effectiveConnectionConfig)
        const connecting = new Promise((resolve, reject) => {
          newClient.once("connect", resolve)
          newClient.once("end", () => reject(Error("Connection ended.")))
          newClient.once("error", reject)
        })
        await Promise.all([
          newClient.connect(),
          connecting
        ])
        connectionLogger("PostgreSQL reconnection succeeded")
        return newClient
      } catch (error) {
        connectionLogger("PostgreSQL reconnection attempt failed:", error)
        await delay(retryInterval)

        if (retryTimeout && (Date.now() - startTime) > retryTimeout) {
          throw new Error(`Stopping PostgreSQL reconnection attempts after ${retryTimeout}ms timeout has been reached.`)
        }
      }
    }

    throw new Error("Reconnecting notification client to PostgreSQL database failed.")
  }

  return {
    dbClient,
    reconnect
  }
}

function forwardDBNotificationEvents (
  dbClient: pg.Client,
  emitter: TypedEventEmitter<PgListenEvents>,
  parse: (stringifiedData: string) => any
) {
  const onNotification = (notification: PgNotification) => {
    notificationLogger(`Received PostgreSQL notification on "${notification.channel}":`, notification.payload)

    let payload
    try {
      payload = notification.payload ? parse(notification.payload) : undefined
    } catch (error) {
      error.message = `Error parsing PostgreSQL notification payload: ${error.message}`
      return emitter.emit("error", error)
    }
    emitter.emit("notification", {
      processId: notification.processId,
      channel: notification.channel,
      payload
    })
  }

  dbClient.on("notification", onNotification)

  return function cancelNotificationForwarding () {
    dbClient.removeListener("notification", onNotification)
  }
}

function scheduleParanoidChecking (dbClient: pg.Client, intervalTime: number, reconnect: () => Promise<void>) {
  const scheduledCheck = async () => {
    try {
      await dbClient.query("SELECT pg_backend_pid()")
      paranoidLogger("Paranoid connection check ok")
    } catch (error) {
      paranoidLogger("Paranoid connection check failed")
      connectionLogger("Paranoid connection check failed:", error)
      await reconnect()
    }
  }

  const interval = setInterval(scheduledCheck, intervalTime)

  return function unschedule () {
    clearInterval(interval)
  }
}

export interface Subscriber<Events extends Record<string, any> = { [channel: string]: any }> {
    /** Emits events: "error", "notification" & "redirect" */
    events: TypedEventEmitter<PgListenEvents>;
    /** For convenience: Subscribe to distinct notifications here, event name = channel name */
    notifications: TypedEventEmitter<EventsToEmitterHandlers<Events>>;
    /** Don't forget to call this asyncronous method before doing your thing */
    connect(): Promise<void>;
    close(): Promise<void>;
    getSubscribedChannels(): string[];
    listenTo(channelName: string): Promise<pg.QueryResult> | undefined;
    notify<EventName extends keyof Events>(
      channelName: any extends Events[EventName] ? EventName : void extends Events[EventName] ? never : EventName,
      payload: Events[EventName] extends void ? never : Events[EventName]
    ): Promise<pg.QueryResult>;
    notify<EventName extends keyof Events>(
      channelName: void extends Events[EventName] ? EventName : never
    ): Promise<pg.QueryResult>;
    unlisten(channelName: string): Promise<pg.QueryResult> | undefined;
    unlistenAll(): Promise<pg.QueryResult>;
}

function createPostgresSubscriber<Events extends Record<string, any> = { [channel: string]: any }> (
  connectionConfig?: pg.ClientConfig,
  options: Options = {}
): Subscriber<Events> {
  const {
    paranoidChecking = 30000,
    parse = JSON.parse,
    serialize = JSON.stringify
  } = options

  const emitter = new EventEmitter() as TypedEventEmitter<PgListenEvents>
  emitter.setMaxListeners(0)    // unlimited listeners

  const notificationsEmitter = new EventEmitter() as TypedEventEmitter<EventsToEmitterHandlers<Events>>
  notificationsEmitter.setMaxListeners(0)   // unlimited listeners

  emitter.on("notification", (notification: PgParsedNotification) => {
    notificationsEmitter.emit<any>(notification.channel, notification.payload)
  })

  const { dbClient: initialDBClient, reconnect } = connect(connectionConfig, emitter, options)

  let closing = false
  let dbClient = initialDBClient
  let reinitializingRightNow = false
  let subscribedChannels: string[] = []

  let cancelEventForwarding: () => void = () => undefined
  let cancelParanoidChecking: () => void = () => undefined

  const initialize = (client: pg.Client) => {
    // Wire the DB client events to our exposed emitter's events
    cancelEventForwarding = forwardDBNotificationEvents(client, emitter, parse)

    dbClient.on("error", (error: any) => {
      if (!reinitializingRightNow) {
        connectionLogger("DB Client error:", error)
        reinitialize()
      }
    })
    dbClient.on("end", () => {
      if (!reinitializingRightNow) {
        connectionLogger("DB Client connection ended")
        reinitialize()
      }
    })

    if (paranoidChecking) {
      cancelParanoidChecking = scheduleParanoidChecking(client, paranoidChecking, reinitialize)
    }
  }

  // No need to handle errors when calling `reinitialize()`, it handles its errors itself
  const reinitialize = async () => {
    if (reinitializingRightNow || closing) {
      return
    }
    reinitializingRightNow = true

    try {
      cancelParanoidChecking()
      cancelEventForwarding()

      dbClient.removeAllListeners()
      dbClient.once("error", error => connectionLogger(`Previous DB client errored after reconnecting already:`, error))
      dbClient.end()

      dbClient = await reconnect(attempt => emitter.emit("reconnect", attempt))
      initialize(dbClient)

      subscriptionLogger(`Re-subscribing to channels: ${subscribedChannels.join(", ")}`)
      await Promise.all(subscribedChannels.map(
        channelName => dbClient.query(`LISTEN ${format.ident(channelName)}`)
      ))

      emitter.emit("connected")
    } catch (error) {
      error.message = `Re-initializing the PostgreSQL notification client after connection loss failed: ${error.message}`
      connectionLogger(error.stack || error)
      emitter.emit("error", error)
    } finally {
      reinitializingRightNow = false
    }
  }

  // TODO: Maybe queue outgoing notifications while reconnecting

  return {
    /** Emits events: "error", "notification" & "redirect" */
    events: emitter,

    /** For convenience: Subscribe to distinct notifications here, event name = channel name */
    notifications: notificationsEmitter,

    /** Don't forget to call this asyncronous method before doing your thing */
    async connect () {
      initialize(dbClient)
      await dbClient.connect()
      emitter.emit("connected")
    },
    close () {
      connectionLogger("Closing PostgreSQL notification listener.")
      closing = true
      cancelParanoidChecking()
      return dbClient.end()
    },
    getSubscribedChannels () {
      return subscribedChannels
    },
    listenTo (channelName: string) {
      if (subscribedChannels.indexOf(channelName) > -1) {
        return
      }
      subscriptionLogger(`Subscribing to PostgreSQL notification "${channelName}"`)

      subscribedChannels = [ ...subscribedChannels, channelName ]
      return dbClient.query(`LISTEN ${format.ident(channelName)}`)
    },
    notify (channelName: string, payload?: any) {
      notificationLogger(`Sending PostgreSQL notification to "${channelName}":`, payload)

      if (payload !== undefined) {
        const serialized = serialize(payload)
        return dbClient.query(`NOTIFY ${format.ident(channelName)}, ${format.literal(serialized)}`)
      } else {
        return dbClient.query(`NOTIFY ${format.ident(channelName)}`)
      }
    },
    unlisten (channelName: string) {
      if (subscribedChannels.indexOf(channelName) === -1) {
        return
      }
      subscriptionLogger(`Unsubscribing from PostgreSQL notification "${channelName}"`)

      subscribedChannels = subscribedChannels.filter(someChannel => someChannel !== channelName)
      return dbClient.query(`UNLISTEN ${format.ident(channelName)}`)
    },
    unlistenAll () {
      subscriptionLogger("Unsubscribing from all PostgreSQL notifications.")

      subscribedChannels = []
      return dbClient.query(`UNLISTEN *`)
    }
  }
}

export default createPostgresSubscriber
