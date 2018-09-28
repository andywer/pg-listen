# pg-listen - PostgreSQL LISTEN & NOTIFY that finally works

[![Build Status](https://travis-ci.org/andywer/pg-listen.svg?branch=master)](https://travis-ci.org/andywer/pg-listen) [![NPM Version](https://img.shields.io/npm/v/pg-listen.svg)](https://www.npmjs.com/package/pg-listen)

PostgreSQL can act as a simple message broker. Send notifications with an arbitrary payload from one database client to other clients, using [`NOTIFY`](https://www.postgresql.org/docs/10/static/sql-notify.html) and subscribe to notifications using [`LISTEN`](https://www.postgresql.org/docs/10/static/sql-listen.html).

Works with plain JavaScript and TypeScript 3.

- Send notifications and subscribe to them
- Continuous connection health checking
- Customizable auto-reconnecting
- Proper error handling
- Type-safe code (TypeScript 3.0)


## Why another package?

Using the `NOTIFY` and `LISTEN` features is not quite trivial using [`node-postgres` (`pg`)](https://www.npmjs.com/package/pg), since you cannot use connection pools and also distinct client connections also tend to time out.

There are already a few packages out there, like `pg-pubsub`, but neither of them seems to work reliably. Errors are being swallowed, the code is hard to reason about, there is no type-safety, ...

This package aims to fix those shortcomings. Postgres LISTEN & NOTIFY in node that finally works.


## Installation

```sh
# using npm:
npm install --save pg-listen

# using yarn
yarn add pg-listen:
```


## Usage

```js
import createPostgresSubscriber from "pg-listen"

const subscriber = createPostgresSubscriber({ connectionString: databaseURL })

subscriber.notifications.on("my-channel", (payload) => {
  console.log("Received notification in 'my-channel':", payload)
})

process.on("exit", () => {
  subscriber.close()
})

export async function setUp (databaseURL) {
  await subscriber.connect()
  await subscriber.listenTo("my-channel")
}

export async function sendMessage (payload) {
  await subscriber.notify("my-channel", payload)
}
```


## API

See [dist/index.d.ts](./dist/index.d.ts).


## Error & event handling

### `instance.events.on("error", listener: (error: Error) => void)`

An `error` event is emitted for fatal errors that affect the notification subscription. A standard way of handling those kinds of errors would be to `console.error()`-log the error and terminate the process with a non-zero exit code.

### `instance.events.on("notification", listener: ({ channel, payload }) => void)`

Emitted whenever a notification is received. You must have subscribed to that channel before using `instance.listenTo()` in order to receive notifications.

A more convenient way of subscribing to notifications is the `instance.notifications` event emitter.

### `instance.events.on("reconnect", listener: (attempt: number) => void)`

Emitted when a connection issue has been detected and an attempt to re-connect to the database is started.


## Debugging

Set the `DEBUG` environment variable to `pg-listen:*` to enable debug logging.


## License

MIT
