import webpush from 'web-push';
import { PushController } from './push.controller';
import { notificationLink, pushPayload, PushService } from './push.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() },
}));

const send = webpush.sendNotification as jest.Mock;
const setVapid = webpush.setVapidDetails as jest.Mock;

const KEYS: Record<string, string> = {
  VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: 'private-key',
  VAPID_SUBJECT: 'mailto:admin@example.com',
  NODE_ENV: 'test',
};
const config = (env: Record<string, string>) =>
  ({ get: (key: string) => env[key] ?? '' }) as never;

function fakeDb() {
  return {
    pushSubscription: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 's1',
          endpoint: 'https://push/1',
          p256dh: 'p1',
          auth: 'a1',
          language: 'fr',
        },
        {
          id: 's2',
          endpoint: 'https://push/2',
          p256dh: 'p2',
          auth: 'a2',
          language: 'en',
        },
      ]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(2),
    },
    user: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ browserNotifications: true }),
    },
  };
}

const NOTIFICATION = {
  id: 'n1',
  type: 'TASK_ASSIGNED',
  message: 'Old text',
  params: { title: 'Rapport annuel' },
  instructionId: 'i1',
  courrierId: null,
  dossierId: null,
  courrierDirection: null,
};

function build(env = KEYS) {
  const database = fakeDb();
  return { database, push: new PushService(database as never, config(env)) };
}

beforeEach(() => {
  send.mockReset().mockResolvedValue({ statusCode: 201 });
  setVapid.mockReset();
});

describe('Diffusion PushService', () => {
  it('is off without VAPID keys, and sends nothing', async () => {
    const { push, database } = build({ NODE_ENV: 'test' });
    expect(push.enabled).toBe(false);
    expect(await push.send(['u1'], NOTIFICATION)).toBe(0);
    push.notify(['u1'], NOTIFICATION);
    expect(database.pushSubscription.findMany).not.toHaveBeenCalled();
  });

  it('stays off (without throwing) when the VAPID keys are invalid', () => {
    setVapid.mockImplementation(() => {
      throw new Error('bad key');
    });
    expect(build().push.enabled).toBe(false);
  });

  it("pushes to the active recipients' browsers, each in its language", async () => {
    const { push, database } = build();
    expect(await push.send(['u1', 'u2'], NOTIFICATION)).toBe(2);
    expect(database.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: ['u1', 'u2'] },
          user: { status: 'ACTIVE', browserNotifications: true },
        },
      }),
    );
    const payloads = send.mock.calls.map(
      ([, json]) => JSON.parse(json as string) as Record<string, string>,
    );
    expect(payloads[0]).toMatchObject({
      id: 'n1',
      tag: 'n1',
      link: '/dashboard/tasks/i1',
    });
    expect(payloads[0].title).not.toEqual(payloads[1].title);
    expect(database.pushSubscription.updateMany).toHaveBeenCalled();
  });

  it('removes the subscriptions the push service no longer knows (404/410)', async () => {
    send
      .mockRejectedValueOnce(
        Object.assign(new Error('gone'), { statusCode: 404 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('busy'), { statusCode: 503 }),
      );
    const { push, database } = build();
    expect(await push.send(['u1'], NOTIFICATION)).toBe(0);
    expect(database.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['s1'] } },
    });
  });

  it('notify never throws, even when the database fails', async () => {
    const { push, database } = build();
    database.pushSubscription.findMany.mockRejectedValue(new Error('down'));
    expect(() => push.notify(['u1'], NOTIFICATION)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('subscribes this browser for the person, with their language, and switches it on', async () => {
    const { push, database } = build();
    await push.subscribe(
      'u1',
      { endpoint: 'https://push/9', keys: { p256dh: 'p9', auth: 'a9' } },
      'it',
      'Firefox',
    );
    expect(database.pushSubscription.upsert).toHaveBeenCalledWith({
      where: { endpoint: 'https://push/9' },
      create: expect.objectContaining({
        endpoint: 'https://push/9',
        userId: 'u1',
        language: 'it',
        userAgent: 'Firefox',
      }),
      update: expect.objectContaining({ userId: 'u1', language: 'it' }),
    });
    expect(database.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', browserNotifications: false },
      data: { browserNotifications: true },
    });
  });

  it("unsubscribes only the person's browser; switching off forgets them all", async () => {
    const { push, database } = build();
    await push.unsubscribe('u1', 'https://push/9');
    expect(database.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push/9', userId: 'u1' },
    });
    expect(await push.setPreference('u1', false)).toMatchObject({
      available: true,
      publicKey: 'public-key',
    });
    expect(database.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });

  it('links and texts as the bell', () => {
    expect(
      notificationLink({
        ...NOTIFICATION,
        instructionId: null,
        courrierId: 'c1',
        courrierDirection: 'SORTANT',
      }),
    ).toBe('/dashboard/outgoing/c1');
    expect(
      notificationLink({
        ...NOTIFICATION,
        instructionId: null,
        dossierId: 'd1',
      }),
    ).toBe('/dashboard/dossiers/d1');
    // No params: the text as written.
    expect(pushPayload({ ...NOTIFICATION, params: null }, 'fr').body).toBe(
      'Old text',
    );
  });
});

describe('Diffusion PushController', () => {
  const push = {
    publicKey: 'public-key',
    enabled: true,
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new PushController(push as never);
  const user = { sub: 'u1' } as never;

  it('gives the key, and subscribes with the language the core gave', async () => {
    expect(controller.key()).toEqual({
      publicKey: 'public-key',
      enabled: true,
    });
    const dto = {
      endpoint: 'https://push/9',
      keys: { p256dh: 'p', auth: 'a' },
    };
    await controller.subscribe(
      user,
      dto,
      {
        core: { account: { language: '', tenant: { defaultLanguage: 'en' } } },
      } as never,
      'Chrome',
    );
    expect(push.subscribe).toHaveBeenCalledWith('u1', dto, 'en', 'Chrome');
    await controller.unsubscribe(user, { endpoint: 'https://push/9' });
    expect(push.unsubscribe).toHaveBeenCalledWith('u1', 'https://push/9');
  });
});
