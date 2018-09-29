import test from "ava"
import createPostgresSubscriber, { PgParsedNotification } from "../src/index"

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
