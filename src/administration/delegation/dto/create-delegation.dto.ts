import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDelegationDto {
  @ApiProperty({ description: 'User handing over the responsibility' })
  @IsUUID()
  delegantId: string;

  @ApiProperty({ description: 'User receiving the responsibility' })
  @IsUUID()
  delegataireId: string;

  @ApiProperty({ example: 'Responsable de dossier' })
  @IsString()
  responsibility: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-09-08' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: 'Congé annuel' })
  @IsOptional()
  @IsString()
  reason?: string;
}
