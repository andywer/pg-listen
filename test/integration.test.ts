import { expect, test } from 'vitest';
import DebugLogger from 'debug';
import { createSubscriber } from '../src/index.js';

// Need to require `pg` like this to avoid ugly error message
import pg = require('pg');

const debug = DebugLogger('pg-listen:test');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectionString = 'postgres://postgres:postgres@localhost:5432/postgres';

test('can connect', async () => {
  const hub = createSubscriber({
    connectionString,
  });
  await hub.connect();
  await hub.close();
});

test('can listen and notify', async () => {
  let connectedEvents = 0;
  const notifications: unknown[] = [];
  const receivedPayloads: unknown[] = [];

  const hub = createSubscriber({
    connectionString,
  });

  hub.events.on('connected', () => ++connectedEvents);
  hub.events.on('notification', (notification: unknown) => notifications.push(notification));
  hub.notifications.on('test', (payload: unknown) => receivedPayloads.push(payload));

  await hub.connect();

  try {
    await hub.listenTo('test');

    await hub.notify('test', { hello: 'world' });
    await hub.notify('test2', 'should not be received, since not subscribed to channel test2');
    await delay(200);

    expect(hub.getSubscribedChannels()).toEqual(['test']);
    expect(notifications).toEqual([
      {
        channel: 'test',
        payload: { hello: 'world' },
        processId: (notifications[0] as { processId?: unknown }).processId,
      },
    ]);
    expect(receivedPayloads).toEqual([{ hello: 'world' }]);
    expect(connectedEvents).toBe(1);
  } finally {
    await hub.close();
  }
});

test('can handle notification without a payload', async () => {
  const notifications: unknown[] = [];
  const receivedPayloads: unknown[] = [];

  const hub = createSubscriber({
    connectionString,
  });
  await hub.connect();

  try {
    await hub.listenTo('test');

    hub.events.on('notification', (notification: unknown) => notifications.push(notification));
    hub.notifications.on('test', (payload: unknown) => receivedPayloads.push(payload));

    await hub.notify('test');
    await delay(200);

    expect(hub.getSubscribedChannels()).toEqual(['test']);
    expect(notifications).toEqual([
      {
        channel: 'test',
        payload: undefined,
        processId: (notifications[0] as { processId?: unknown }).processId,
      },
    ]);
    expect(receivedPayloads).toEqual([undefined]);
  } finally {
    await hub.close();
  }
});

test('can use custom `parse` function', async () => {
  const notifications: unknown[] = [];

  const hub = createSubscriber(
    { connectionString },
    { parse: (base64: string) => Buffer.from(base64, 'base64').toString('utf8') },
  );
  await hub.connect();

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    await hub.listenTo('test');
    await hub.events.on('notification', (notification: unknown) =>
      notifications.push(notification),
    );

    await client.query(
      `NOTIFY test, '${Buffer.from('I am a payload.', 'utf8').toString('base64')}'`,
    );
    await delay(200);

    expect(notifications).toEqual([
      {
        channel: 'test',
        payload: 'I am a payload.',
        processId: (notifications[0] as { processId?: unknown }).processId,
      },
    ]);
  } finally {
    await hub.close();
    await client.end();
  }
});

test('getting notified after connection is terminated', async () => {
  let connectedEvents = 0;
  let reconnects = 0;

  const notifications: unknown[] = [];
  const receivedPayloads: unknown[] = [];

  const client = new pg.Client({ connectionString });
  await client.connect();

  const hub = createSubscriber(
    { connectionString: `${connectionString}?ApplicationName=pg-listen-termination-test` },
    { paranoidChecking: 1000 },
  );

  hub.events.on('connected', () => ++connectedEvents);
  hub.events.on('notification', (notification: unknown) => notifications.push(notification));
  hub.events.on('reconnect', () => ++reconnects);
  hub.notifications.on('test', (payload) => receivedPayloads.push(payload));

  await hub.connect();

  try {
    await hub.listenTo('test');

    await delay(1000);
    debug('Terminating database backend');

    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND usename = current_user',
    );
    await delay(2000);

    debug('Sending notification...');
    await client.query(`NOTIFY test, '{"hello": "world"}';`);
    await delay(500);

    expect(hub.getSubscribedChannels()).toEqual(['test']);
    expect(notifications).toEqual([
      {
        channel: 'test',
        payload: { hello: 'world' },
        processId: (notifications[0] as { processId?: unknown }).processId,
      },
    ]);
    expect(receivedPayloads).toEqual([{ hello: 'world' }]);
    expect(reconnects).toBe(1);
    expect(connectedEvents).toBe(2);
  } finally {
    debug('Closing the subscriber');
    await hub.close();
    await client.end();
  }
});
