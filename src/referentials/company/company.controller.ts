import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { PermissionsGuard } from '../../auth/access/permissions.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthUser } from '../../auth/types/auth-user.type';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { FindCompaniesQueryDto } from './dto/find-companies.query.dto';
import { CompanyService } from './company.service';

@ApiTags('companies')
@ApiCookieAuth('creapp_access')
@UseGuards(CoreAuthGuard, PermissionsGuard)
// Companies are the core's companies: created, named, (de)activated and removed
// there (DirectorySyncService). Diffusion edits their city and responsible.
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  findAll(
    @Query() query: FindCompaniesQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companyService.findAll(query, user.sub);
  }

  @Get(':uuid')
  findOne(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companyService.findVisible(uuid, user.sub);
  }

  // company.update, for the person's own company — checked in CompanyService.
  @Patch(':uuid')
  update(
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.companyService.update(uuid, dto, user.sub);
  }
}
