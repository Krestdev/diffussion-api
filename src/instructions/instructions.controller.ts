import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InstructionsService } from './instructions.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayloadWithRefreshToken } from '../auth/types/jwt-payload.type';
import { AssignInstructionDto } from './dto/assign-instruction.dto';
import { CreateInstructionsDto } from './dto/create-instruction.dto';
import { FindInstructionsQueryDto } from './dto/find-instructions.query.dto';
import { RefuseInstructionDto } from './dto/refuse-instruction.dto';
import { UpdateInstructionDto } from './dto/update-instruction.dto';

@ApiTags('instructions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('instructions')
export class InstructionsController {
  constructor(private readonly instructionsService: InstructionsService) {}

  @Post()
  @RequirePermission(PermissionCode.InstructionCreate)
  create(
    @Body() dto: CreateInstructionsDto,
    @CurrentUser() user: JwtPayloadWithRefreshToken,
  ) {
    return this.instructionsService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: FindInstructionsQueryDto) {
    return this.instructionsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstructionDto,
  ) {
    return this.instructionsService.update(id, dto);
  }

  @Post(':id/assign')
  @RequirePermission(PermissionCode.InstructionAssign)
  assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignInstructionDto,
  ) {
    return this.instructionsService.assign(id, dto);
  }

  @Patch(':id/refuse')
  @RequirePermission(PermissionCode.InstructionRefuse)
  refuse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefuseInstructionDto,
  ) {
    return this.instructionsService.refuse(id, dto);
  }

  @Patch(':id/approve-livrables')
  @RequirePermission(PermissionCode.ValidationApprove)
  approveLivrables(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.approveLivrables(id);
  }

  @Patch(':id/request-corrections')
  @RequirePermission(PermissionCode.ValidationRequestCorrections)
  requestCorrections(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('motif') motif: string,
  ) {
    return this.instructionsService.requestCorrections(id, motif);
  }

  @Patch(':id/close')
  @RequirePermission(PermissionCode.InstructionClose)
  close(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.close(id);
  }

  @Patch(':id/cancel')
  @RequirePermission(PermissionCode.InstructionAssign)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.instructionsService.cancel(id);
  }
}
