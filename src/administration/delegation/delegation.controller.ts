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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateDelegationDto } from './dto/create-delegation.dto';
import { UpdateDelegationDto } from './dto/update-delegation.dto';
import { DelegationService } from './delegation.service';

@ApiTags('delegations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('delegations')
export class DelegationController {
  constructor(private readonly delegationService: DelegationService) {}

  @Post()
  create(@Body() dto: CreateDelegationDto) {
    return this.delegationService.create(dto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.delegationService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.delegationService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDelegationDto,
  ) {
    return this.delegationService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.delegationService.remove(id);
  }
}
