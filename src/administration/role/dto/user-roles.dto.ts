import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class SetUserRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(50)
  roleIds!: string[];
}

export class UserIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(1000)
  userIds!: string[];
}
