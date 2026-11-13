import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

// The whole list of users allowed to open a project or a contract; an
// empty list opens it to everyone.
export class SetReferentialAccessDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  userIds: string[];
}
