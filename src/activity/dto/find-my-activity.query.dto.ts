import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.query.dto';

// The kinds of objects of a user's own history.
export const MY_ACTIVITY_ENTITY_TYPES = [
  'Courrier',
  'Instruction',
  'analysis-sheet',
] as const;

export class FindMyActivityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: MY_ACTIVITY_ENTITY_TYPES,
    description: 'Only this kind of object',
  })
  @IsOptional()
  @IsIn(MY_ACTIVITY_ENTITY_TYPES)
  entityType?: (typeof MY_ACTIVITY_ENTITY_TYPES)[number];
}
