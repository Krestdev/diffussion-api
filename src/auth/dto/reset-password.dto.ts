import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token from the reset link' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ example: 'N3wStr0ngP@ssword' })
  @IsString()
  @MinLength(8)
  password: string;
}
