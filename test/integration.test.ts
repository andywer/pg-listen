import test from "ava"
import DebugLogger from "debug"
import createPostgresSubscriber, { PgParsedNotification } from "../src/index"

// Need to require `pg` like this to avoid ugly error message
import pg = require("pg")

const debug = DebugLogger("pg-listen:test")
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test("can connect", async t => {
  const hub = createPostgresSubscriber({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" })
  await hub.connect()
  await hub.close()
  t.pass()
})

test("can listen and notify", async t => {
  const notifications: PgParsedNotification[] = []
  const receivedPayloads: any[] = []

  const hub = createPostgresSubscriber({ connectionString: "postgres://postgres:postgres@localhost:5432/postgres" })
  await hub.connect()

  try {
    await hub.listenTo("test")
    await hub.events.on("notification", (notification: PgParsedNotification) => notifications.push(notification))
    await hub.notifications.on("test", (payload: any) => receivedPayloads.push(payload))

    await hub.notify("test", { hello: "world" })
    await hub.notify("test2", "should not be received, since not subscribed to channel test2")
    await delay(200)

    t.deepEqual(hub.getSubscribedChannels(), ["test"])
    t.deepEqual(notifications, [
      {
        channel: "test",
        payload: { hello: "world" },
        processId: notifications[0].processId
      }
    ])
    t.deepEqual(receivedPayloads, [
      { hello: "world" }
    ])
  } finally {
    await hub.close()
  }
})

test("getting notified after connection is terminated", async t => {
  const notifications: PgParsedNotification[] = []
  const receivedPayloads: any[] = []
  let reconnects = 0

  const connectionString = "postgres://postgres:postgres@localhost:5432/postgres"
  let client = new pg.Client({ connectionString })
  await client.connect()

  const hub = createPostgresSubscriber(
    { connectionString: connectionString + "?ApplicationName=pg-listen-termination-test" },
    { paranoidChecking: 1000 }
  )
  await hub.connect()

  try {
    await hub.listenTo("test")
    hub.events.on("notification", (notification: PgParsedNotification) => notifications.push(notification))
    hub.events.on("reconnect", () => reconnects++)
    hub.notifications.on("test", (payload: any) => receivedPayloads.push(payload))

    await delay(1000)
    debug("Terminating database backend")

    // Don't await as we kill some other connection, so the promise won't resolve (I think)
    client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = current_user")
    await delay(2000)

    client = new pg.Client({ connectionString })
    await client.connect()

    debug("Sending notification...")
    await client.query(`NOTIFY test, '{"hello": "world"}';`)
    await delay(500)

    t.deepEqual(hub.getSubscribedChannels(), ["test"])
    t.deepEqual(notifications, [
      {
        channel: "test",
        payload: { hello: "world" },
        processId: notifications[0] ? notifications[0].processId : 0
      }
    ])
    t.deepEqual(receivedPayloads, [
      { hello: "world" }
    ])
    t.is(reconnects, 1)
  } finally {
    debug("Closing the subscriber")
    await hub.close()
  }
})
