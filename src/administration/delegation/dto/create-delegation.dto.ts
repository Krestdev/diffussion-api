import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDelegationDto {
  @ApiProperty({ description: 'User handing over the responsibility' })
  @IsUUID()
  delegantId: string;

  @ApiProperty({ description: 'User receiving the responsibility' })
  @IsUUID()
  delegataireId: string;

  @ApiProperty({
    description:
      'Role handed over — the delegataire is treated as holding it at the site below, for the period',
  })
  @IsUUID()
  roleId: string;

  @ApiProperty({
    description:
      'Site the delegation applies to. The delegataire must already be assigned to it.',
  })
  @IsUUID()
  siteId: string;

  @ApiPropertyOptional({
    example: 'Responsable de dossier',
    description: 'Free-text label for the register — carries no rights',
  })
  @IsOptional()
  @IsString()
  responsibility?: string;

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
