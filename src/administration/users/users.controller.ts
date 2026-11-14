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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { CoreAuthGuard } from '../../auth/guards/core-auth.guard';
import { AuthUser } from '../../auth/types/auth-user.type';
import { FindDirectoryQueryDto } from './dto/find-directory.query.dto';
import { FindUsersQueryDto } from './dto/find-users.query.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth('creapp_access')
// People are created, invited, edited, suspended and removed in the CREAPP
// core's console; Diffusion lists them and gives them its roles. A site's
// responsible (its administrator) manages only that site's users; a platform
// administrator (global ADMIN_MANAGE_USERS) manages everyone. Enforced in
// UsersService, since the responsible needs no role for it.
@UseGuards(CoreAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
