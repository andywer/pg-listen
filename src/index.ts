import createDebugLogger from "debug"
import EventEmitter from "events"
import pg from "pg"
import format from "pg-format"
import TypedEventEmitter from "typed-emitter"

const connectionLogger = createDebugLogger("pg-listen:connection")
const notificationLogger = createDebugLogger("pg-listen:notification")
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
  error: (error: Error) => void,
  notification: (notification: PgParsedNotification) => void,
  reconnect: (attempt: number) => void
}

interface NotificationEvents {
  [channelName: string]: (payload: any) => void
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
}

function connect (connectionConfig: pg.ConnectionConfig | undefined, options: Options) {
  connectionLogger("Creating PostgreSQL client for notification streaming")

  const { retryInterval = 500, retryLimit = Infinity, retryTimeout = 3000 } = options
  const effectiveConnectionConfig: pg.ConnectionConfig = { ...connectionConfig, keepAlive: true }

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
        await newClient.connect()
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

function forwardDBNotificationEvents (dbClient: pg.Client, emitter: TypedEventEmitter<PgListenEvents>) {
  const onNotification = (notification: PgNotification) => {
    notificationLogger(`Received PostgreSQL notification on "${notification.channel}":`, notification.payload)

    let payload
    try {
      payload = notification.payload ? JSON.parse(notification.payload) : notification.payload
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
      await dbClient.query("SELECT 1")
    } catch (error) {
      connectionLogger("Paranoid connection check failed:", error)
      await reconnect()
    }
  }

  const interval = setInterval(scheduledCheck, intervalTime)

  return function unschedule () {
    clearInterval(interval)
  }
}

function createPostgresSubscriber (connectionConfig?: pg.ConnectionConfig, options: Options = {}) {
  const { paranoidChecking = 30000 } = options

  const emitter = new EventEmitter() as TypedEventEmitter<PgListenEvents>
  emitter.setMaxListeners(0)    // unlimited listeners

  const notificationsEmitter = new EventEmitter() as TypedEventEmitter<NotificationEvents>
  notificationsEmitter.setMaxListeners(0)   // unlimited listeners

  emitter.on("notification", (notification: PgParsedNotification) => {
    notificationsEmitter.emit(notification.channel, notification.payload)
  })

  const { dbClient: initialDBClient, reconnect } = connect(connectionConfig, options)

  let closing = false
  let dbClient = initialDBClient
  let subscribedChannels: string[] = []

  let cancelEventForwarding: () => void = () => undefined
  let cancelParanoidChecking: () => void = () => undefined

  const initialize = async (client: pg.Client) => {
    // Wire the DB client events to our exposed emitter's events
    cancelEventForwarding = forwardDBNotificationEvents(client, emitter)

    dbClient.on("error", (error: any) => {
      connectionLogger("DB Client error:", error)
      reinitialize()
    })
    dbClient.on("end", () => {
      connectionLogger("DB Client connection ended")
      if (!closing) {
        reinitialize()
      }
    })

    if (paranoidChecking) {
      cancelParanoidChecking = scheduleParanoidChecking(client, paranoidChecking, reinitialize)
    }
  }

  // No need to handle errors when calling `reinitialize()`, it handles its errors itself
  const reinitialize = async () => {
    try {
      cancelParanoidChecking()
      cancelEventForwarding()

      dbClient = await reconnect(attempt => emitter.emit("reconnect", attempt))
      await initialize(dbClient)

      await Promise.all(subscribedChannels.map(
        channelName => `LISTEN ${format.ident(channelName)}`
      ))
    } catch (error) {
      error.message = `Re-initializing the PostgreSQL notification client after connection loss failed: ${error.message}`
      emitter.emit("error", error)
    }
  }

  // TODO: Maybe queue outgoing notifications while reconnecting

  return {
    /** Emits events: "error", "notification" & "redirect" */
    events: emitter,

    /** For convenience: Subscribe to distinct notifications here, event name = channel name */
    notifications: notificationsEmitter,

    /** Don't forget to call this asyncronous method before doing your thing */
    connect () {
      initialize(dbClient)
      return dbClient.connect()
    },
    close () {
      connectionLogger("Closing PostgreSQL notification listener.")
      closing = true
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
    notify (channelName: string, payload: any) {
      notificationLogger(`Sending PostgreSQL notification to "${channelName}":`, payload)
      return dbClient.query(`NOTIFY ${format.ident(channelName)}, ${format.literal(JSON.stringify(payload))}`)
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
