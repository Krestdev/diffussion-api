import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CircuitInstanceController } from './circuit-instance.controller';
import { CircuitInstanceService } from './circuit-instance.service';

describe('CircuitInstanceController', () => {
  let controller: CircuitInstanceController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      start: jest.fn(),
      decide: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CircuitInstanceController],
      providers: [{ provide: CircuitInstanceService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CircuitInstanceController>(
      CircuitInstanceController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('start() forwards the current user', () => {
    controller.start(
      { courrierId: 'c-1' },
      { sub: 'u-1', email: 'u@x.com', refreshToken: 'r' },
    );
    expect(service.start).toHaveBeenCalledWith({ courrierId: 'c-1' }, 'u-1');
  });

  it('decide() forwards the current user', () => {
    controller.decide(
      'inst-1',
      { decision: 'VALIDE' },
      { sub: 'u-1', email: 'u@x.com', refreshToken: 'r' },
    );
    expect(service.decide).toHaveBeenCalledWith(
      'inst-1',
      { decision: 'VALIDE' },
      'u-1',
    );
  });
});
