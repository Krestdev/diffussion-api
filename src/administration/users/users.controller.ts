import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import { FindDirectoryQueryDto } from './dto/find-directory.query.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';
import { CoreClient } from '../../core/core-client';

@ApiTags('users')
@ApiCookieAuth('creapp_access')
// People are created, invited, edited, suspended and removed in the CREAPP
// core's console; Diffusion lists them (user.read) and gives them its roles
// (role.assign), within the person's own company. Enforced in UsersService
// (the directory below is open to every signed-in person).
@UseGuards(CoreAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly core: CoreClient,
  ) {}

  @Get()
  findAll(@Query() query: FindUsersQueryDto, @CurrentUser() user: AuthUser) {
    return this.usersService.findAll(query, user.sub);
  }

  // The people pickers, for every signed-in user (unlike GET /users, the
  // administration list). Declared before ':id'.
  @Get('directory')
  directory(
    @Query() query: FindDirectoryQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.directory(query, user.sub);
  }

  /**
   * A colleague's photo (avatars everywhere, as EXPENZO's), served from the
   * core; 404 when there is none (the interface shows the initials). Any
   * signed-in person of the same company. Declared before ':id'.
   */
  @Get(':id/photo')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Asked again every time (a changed photo shows at once); an unchanged one is a 304.
    res.setHeader('Cache-Control', 'private, no-cache');
    const photo =
      this.core.configured &&
      (await this.usersService.isColleague(id, user.sub))
        ? await this.core.photo(id).catch(() => null)
        : null;
    if (!photo) {
      res.status(HttpStatus.NOT_FOUND).json({ code: 'NOT_FOUND' });
      return;
    }
    const etag = `"${createHash('sha1').update(photo.bytes).digest('base64url')}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(photo.bytes);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.findOne(id, user.sub);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.update(id, dto, user.sub);
  }
}
