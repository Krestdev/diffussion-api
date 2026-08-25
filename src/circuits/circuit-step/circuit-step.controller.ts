import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { CircuitStepService } from './circuit-step.service';
import { CreateCircuitStepDto } from './dto/create-circuit-step.dto';
import { UpdateCircuitStepDto } from './dto/update-circuit-step.dto';

@Controller('circuit-step')
export class CircuitStepController {
  constructor(private readonly circuitStepService: CircuitStepService) {}

  @Post()
  create(@Body() createCircuitStepDto: CreateCircuitStepDto) {
    return this.circuitStepService.create(createCircuitStepDto);
  }

  @Get()
  findAll() {
    return this.circuitStepService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.circuitStepService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCircuitStepDto: UpdateCircuitStepDto) {
    return this.circuitStepService.update(+id, updateCircuitStepDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.circuitStepService.remove(+id);
  }
}
