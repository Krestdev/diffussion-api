import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Str0ngP@ssword' })
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty({ example: 'N3wStr0ngP@ssword' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
