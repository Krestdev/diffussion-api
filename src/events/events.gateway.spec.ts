import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { EventsGateway } from './events.gateway';

describe('EventsGateway', () => {
  let gateway: EventsGateway;
  let jwtService: { verify: jest.Mock };

  function fakeClient(auth: Record<string, unknown> = {}, headers: Record<string, unknown> = {}) {
    return {
      id: 'socket-1',
      handshake: { auth, headers },
      join: jest.fn(),
      disconnect: jest.fn(),
    } as never;
  }

  beforeEach(async () => {
    jwtService = { verify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EventsGateway, { provide: JwtService, useValue: jwtService }],
    }).compile();

    gateway = module.get<EventsGateway>(EventsGateway);
    gateway.server = { to: jest.fn().mockReturnThis(), emit: jest.fn() } as never;
  });

  it('is defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('disconnects a client with no token at all', () => {
      const client = fakeClient();
      gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verify).not.toHaveBeenCalled();
    });

    it('disconnects a client whose token fails verification', () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      const client = fakeClient({ token: 'bad-token' });
      gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins the user-scoped room for a valid token', () => {
      jwtService.verify.mockReturnValue({ sub: 'u-1', email: 'u@x.com' });
      const client = fakeClient({ token: 'good-token' });
      gateway.handleConnection(client);
      expect(client.join).toHaveBeenCalledWith('user:u-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('emitToUser', () => {
    it('emits into the recipient-only room', () => {
      gateway.emitToUser('u-1', 'notification:new');
      expect(gateway.server.to).toHaveBeenCalledWith('user:u-1');
      expect(gateway.server.emit).toHaveBeenCalledWith('notification:new', undefined);
    });
  });

  describe('broadcast', () => {
    it('emits to every connected client', () => {
      gateway.broadcast('user:new');
      expect(gateway.server.emit).toHaveBeenCalledWith('user:new', undefined);
    });
  });
});
