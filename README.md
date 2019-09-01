# pg-listen - Postgres LISTEN & NOTIFY that works

[![Build Status](https://travis-ci.org/andywer/pg-listen.svg?branch=master)](https://travis-ci.org/andywer/pg-listen) [![NPM Version](https://img.shields.io/npm/v/pg-listen.svg)](https://www.npmjs.com/package/pg-listen)

PostgreSQL can act as a message broker: Send notifications with arbitrary payloads from one database client to others.

Works with node.js 8+ and plain JavaScript or TypeScript 3. Uses the Postgres [`NOTIFY`](https://www.postgresql.org/docs/10/static/sql-notify.html) statement and subscribes to notifications using [`LISTEN`](https://www.postgresql.org/docs/10/static/sql-listen.html).

### Features

&nbsp;&nbsp;&nbsp;&nbsp;📡&nbsp;&nbsp;Send and subscribe to messages

&nbsp;&nbsp;&nbsp;&nbsp;⏳&nbsp;&nbsp;Continuous connection health checks

&nbsp;&nbsp;&nbsp;&nbsp;♻️&nbsp;&nbsp;Reconnects automatically

&nbsp;&nbsp;&nbsp;&nbsp;❗️&nbsp;&nbsp;Proper error handling

&nbsp;&nbsp;&nbsp;&nbsp;👌&nbsp;&nbsp;Type-safe API

---


## Installation

```sh
# using npm:
npm install pg-listen

# using yarn:
yarn add pg-listen
```


## Usage

```js
import createSubscriber from "pg-listen"
import { databaseURL } from "./config"

// Accepts the same connection config object that the "pg" package would take
const subscriber = createSubscriber({ connectionString: databaseURL })

subscriber.notifications.on("my-channel", (payload) => {
  // Payload as passed to subscriber.notify() (see below)
  console.log("Received notification in 'my-channel':", payload)
})

subscriber.events.on("error", (error) => {
  console.error("Fatal database connection error:", error)
  process.exit(1)
})

process.on("exit", () => {
  subscriber.close()
})

export async function connect () {
  await subscriber.connect()
  await subscriber.listenTo("my-channel")
}

export async function sendSampleMessage () {
  await subscriber.notify({
    greeting: "Hey, buddy.",
    timestamp: Date.now()
  })
}
```


## API

For details see [dist/index.d.ts](./dist/index.d.ts).


## Error & event handling

#### `instance.events.on("connected", listener: () => void)`

The `connected` event is emitted once after initially establishing the connection and later once after every successful reconnect. Reconnects happen automatically when `pg-listen` detects that the connection closed or became unresponsive.

#### `instance.events.on("error", listener: (error: Error) => void)`

An `error` event is emitted for fatal errors that affect the notification subscription. A standard way of handling those kinds of errors would be to `console.error()`-log the error and terminate the process with a non-zero exit code.

This `error` event is usually emitted after multiple attempts to reconnect have failed.

#### `instance.events.on("notification", listener: ({ channel, payload }) => void)`

Emitted whenever a notification is received. You must have subscribed to that channel before using `instance.listenTo()` in order to receive notifications.

A more convenient way of subscribing to notifications is the `instance.notifications` event emitter.

#### `instance.events.on("reconnect", listener: (attempt: number) => void)`

Emitted when a connection issue has been detected and an attempt to re-connect to the database is started.

#### `instance.notifications.on(channelName: string, listener: (payload: any) => void)`

The convenient way of subscribing to notifications. Don't forget to call `.listenTo(channelName)` to subscribe the Postgres client to this channel in order to receive notifications.


## Why another package?

In one sentence: Because none of the existing packages was working reliably in production.

Using the `NOTIFY` and `LISTEN` features is not trivial using [`node-postgres` (`pg`)](https://www.npmjs.com/package/pg), since you cannot use connection pools and even distinct client connections also tend to time out.

There are already a few packages out there, like `pg-pubsub`, but neither of them seems to work reliably. Errors are being swallowed, the code is hard to reason about, there is no type-safety, ...

This package aims to fix those shortcomings. Postgres LISTEN & NOTIFY in node that finally works.


## Debugging

Set the `DEBUG` environment variable to `pg-listen:*` to enable debug logging.


## License

MIT
