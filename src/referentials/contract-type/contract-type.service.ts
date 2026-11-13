import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ActivityService } from '../../activity/activity.service';
import { AuditLog } from '../../activity/decorators/audit-log.decorator';
import { DatabaseService } from '../../database/database.service';

export class CreateContractTypeDto {
  @ApiProperty({
    example: 'MOE',
    description: 'Stored on each contract (Contract.type); capitals, digits, _',
  })
  @IsString()
  @Matches(/^[A-Z0-9_]{2,30}$/, {
    message: 'code: 2 to 30 capitals, digits or _',
  })
  code: string;

  @ApiProperty({ example: "Maîtrise d'œuvre" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'An inactive type is no longer offered for new contracts',
  })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

// The code is the contracts' key: renaming it carries over to them
// (ON UPDATE CASCADE), so it may change.
export class UpdateContractTypeDto extends PartialType(CreateContractTypeDto) {}

export class FindContractTypesQueryDto {
  @ApiPropertyOptional({ description: 'true: the active ones only' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active?: boolean;
}

/**
 * The kinds of contract (PA·7): one list common to every site, managed by a
 * platform administrator. Deactivated rather than deleted once used.
 */
@Injectable()
export class ContractTypeService {
  constructor(
    private readonly database: DatabaseService,
    // Read by @AuditLog through `this.activity`.
    private readonly activity: ActivityService,
  ) {}

  findAll(query: FindContractTypesQueryDto = {}) {
    return this.database.contractTypeItem.findMany({
      where: { active: query.active },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
      include: { _count: { select: { contracts: true } } },
    });
  }

  async findOne(id: string) {
    const type = await this.database.contractTypeItem.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });
    if (!type) throw new NotFoundException(`Contract type ${id} not found`);
    return type;
  }

  @AuditLog({
    action: 'contract-type.created',
    entityType: 'contract-type',
    operation: 'CREATE',
  })
  async create(dto: CreateContractTypeDto) {
    await this.assertCodeAvailable(dto.code);
    return this.database.contractTypeItem.create({ data: dto });
  }

  @AuditLog({
    action: 'contract-type.updated',
    entityType: 'contract-type',
    operation: 'UPDATE',
  })
  async update(id: string, dto: UpdateContractTypeDto) {
    const type = await this.findOne(id);
    if (dto.code !== undefined && dto.code !== type.code) {
      await this.assertCodeAvailable(dto.code);
    }
    return this.database.contractTypeItem.update({
      where: { id },
      data: dto,
    });
  }

  @AuditLog({
    action: 'contract-type.deleted',
    entityType: 'contract-type',
    operation: 'DELETE',
  })
  async remove(id: string) {
    const type = await this.findOne(id);
    if (type._count.contracts > 0) {
      throw new ConflictException(
        `This type is used by ${type._count.contracts} contract(s) — deactivate it instead`,
      );
    }
    await this.database.contractTypeItem.delete({ where: { id } });
  }

  private async assertCodeAvailable(code: string) {
    const taken = await this.database.contractTypeItem.findUnique({
      where: { code },
      select: { id: true },
    });
    if (taken) {
      throw new ConflictException(`A contract type ${code} already exists`);
    }
  }
}
