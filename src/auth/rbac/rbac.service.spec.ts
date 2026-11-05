import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { RbacService } from './rbac.service';

describe('RbacService.resolveSiteId', () => {
  let service: RbacService;
  let database: {
    courrier: { findUnique: jest.Mock };
    instruction: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    database = {
      courrier: { findUnique: jest.fn() },
      instruction: { findUnique: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: DatabaseService, useValue: database },
      ],
    }).compile();
    service = module.get(RbacService);
  });

  describe('an effet', () => {
    it("is its dossier's site", async () => {
      database.courrier.findUnique.mockResolvedValue({
        dossier: { siteId: 's-dossier' },
        createdBy: { siteId: 's-registrant' },
      });

      await expect(service.resolveSiteId('courrier', 'c-1')).resolves.toBe(
        's-dossier',
      );
    });

    it("without a dossier, is its registrant's site — never no site", async () => {
      database.courrier.findUnique.mockResolvedValue({
        dossier: null,
        createdBy: { siteId: 's-registrant' },
      });

      await expect(service.resolveSiteId('courrier', 'c-1')).resolves.toBe(
        's-registrant',
      );
    });
  });

  describe('a task', () => {
    it("without a dossier, is its effet's site", async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossier: null,
        courrier: { dossier: null, createdBy: { siteId: 's-effet' } },
        contract: { project: { siteId: 's-project' } },
      });

      await expect(service.resolveSiteId('instruction', 'i-1')).resolves.toBe(
        's-effet',
      );
    });

    it("on a contract only, is its contract's project's site", async () => {
      database.instruction.findUnique.mockResolvedValue({
        dossier: null,
        courrier: null,
        contract: { project: { siteId: 's-project' } },
      });

      await expect(service.resolveSiteId('instruction', 'i-1')).resolves.toBe(
        's-project',
      );
    });
  });
});
