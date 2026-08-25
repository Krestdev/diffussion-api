import { Test, TestingModule } from '@nestjs/testing';
import { CircuitController } from './circuit.controller';
import { CircuitService } from './circuit.service';

describe('CircuitController', () => {
  let controller: CircuitController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CircuitController],
      providers: [CircuitService],
    }).compile();

    controller = module.get<CircuitController>(CircuitController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
