import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { JwtPayloadWithRefreshToken } from '../../auth/types/jwt-payload.type';
import { CircuitInstanceService } from './circuit-instance.service';
import { CreateCircuitInstanceDto } from './dto/create-circuit-instance.dto';
import { DecideCircuitInstanceDto } from './dto/decide-circuit-instance.dto';
import { FindCircuitInstancesQueryDto } from './dto/find-circuit-instances.query.dto';

// No blanket @RequirePermission here: eligibility to trigger/act on a given
// circuit or step is enforced inside the service against Circuit.roleId /
// CircuitStep.roleId (any authenticated user may call these routes; the
// service is what actually gates who can act).
@ApiTags('circuit-instances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('circuit-instances')
export class CircuitInstanceController {
  constructor(
    private readonly circuitInstanceService: CircuitInstanceService,
  ) {}

  @Get()
  findAll(@Query() query: FindCircuitInstancesQueryDto) {
    return this.circuitInstanceService.findAll(query);
  }

  // Registered before ':id' — otherwise "eligible-owners" would be parsed
  // as an instance id and 404 against findOne().
  @Get('eligible-owners')
  getEligibleOwners(@Query('dossierId', ParseUUIDPipe) dossierId: string) {
    return this.circuitInstanceService.getEligibleOwners(dossierId);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.circuitInstanceService.findOne(id);
  }

  @Post()
  start(
    @Body() dto: CreateCircuitInstanceDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.circuitInstanceService.start(dto, user.sub);
  }

  @Post(':id/decide')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideCircuitInstanceDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.circuitInstanceService.decide(id, dto, user.sub);
  }
}
