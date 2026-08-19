import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../auth/rbac/permission.guard';
import { PermissionCode } from '../auth/rbac/rbac.constants';
import { RequirePermission } from '../auth/rbac/require-permission.decorator';
import { CreateDocumentDto } from './dto/create-document.dto';
import { FindDocumentsQueryDto } from './dto/find-documents.query.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { DocumentService } from './document.service';

@ApiTags('documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  create(@Body() dto: CreateDocumentDto) {
    return 'document created';
  }

  @UseGuards(PermissionGuard)
  @RequirePermission(PermissionCode.DossierRead)
  @Get()
  findAll(@Query() query: FindDocumentsQueryDto) {
    return 'find all documents';
  }

  @Get(':uuid')
  findOne(@Param('uuid', ParseIntPipe) uuid: number) {
    return 'find one document';
  }

  @Patch(':uuid')
  update(
    @Param('uuid', ParseIntPipe) uuid: number,
    @Body() dto: UpdateDocumentDto,
  ) {
    return 'document updated';
  }

  @Delete(':uuid')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('uuid', ParseIntPipe) uuid: number) {
    return 'document deleted';
  }
}
