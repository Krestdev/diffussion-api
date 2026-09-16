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
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { CircuitService } from './circuit.service';
import { CreateCircuitDto } from './dto/create-circuit.dto';
import { UpdateCircuitDto } from './dto/update-circuit.dto';

@ApiTags('circuits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePermission(PermissionCode.AdminManageCircuits)
@Controller('circuits')
export class CircuitController {
  constructor(private readonly circuitService: CircuitService) {}

  @Post()
  create(@Body() dto: CreateCircuitDto) {
    return this.circuitService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.circuitService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.circuitService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCircuitDto,
  ) {
    return this.circuitService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.circuitService.remove(id);
  }
}
