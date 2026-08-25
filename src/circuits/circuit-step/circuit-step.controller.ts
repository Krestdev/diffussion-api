import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../../auth/rbac/permission.guard';
import { PermissionCode } from '../../auth/rbac/rbac.constants';
import { RequirePermission } from '../../auth/rbac/require-permission.decorator';
import { CircuitStepService } from './circuit-step.service';
import { CreateCircuitStepDto } from './dto/create-circuit-step.dto';
import { UpdateCircuitStepDto } from './dto/update-circuit-step.dto';

@ApiTags('circuit-steps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(PermissionCode.AdminManageCircuits)
@Controller('circuit-steps')
export class CircuitStepController {
  constructor(private readonly circuitStepService: CircuitStepService) {}

  @Post()
  create(@Body() dto: CreateCircuitStepDto) {
    return this.circuitStepService.create(dto);
  }

  @Get()
  findAll(@Query('circuitId') circuitId?: string) {
    return this.circuitStepService.findAll(circuitId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.circuitStepService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCircuitStepDto,
  ) {
    return this.circuitStepService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.circuitStepService.remove(id);
  }
}
