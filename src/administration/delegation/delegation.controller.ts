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
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';
import { DelegationService } from './delegation.service';

@ApiTags('delegations')
@ApiBearerAuth()
// A delegation hands one user's responsibilities to another, so managing
// them is an administration act over people — same gate as user management.
// Scope (platform administrator, or the site's responsible) is enforced in
// DelegationService.
@UseGuards(JwtAuthGuard)
@Controller('delegations')
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  @Post()
  create(@Body() dto: CreateDelegationDto, @CurrentUser() user: JwtPayload) {
    return this.delegationService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto, @CurrentUser() user: JwtPayload) {
    return this.delegationService.findAll(query, user.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.delegationService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDelegationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.delegationService.update(id, dto, user.sub);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.delegationService.remove(id, user.sub);
  }
}
