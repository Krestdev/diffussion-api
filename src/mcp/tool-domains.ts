import type { Type } from '@nestjs/common';
import { ActivityController } from '../activity/activity.controller';
import { DelegationController } from '../administration/delegation/delegation.controller';
import { PermissionController } from '../administration/permission/permission.controller';
import { RoleController } from '../administration/role/role.controller';
import { SettingsController } from '../administration/settings/settings.controller';
import { UsersController } from '../administration/users/users.controller';
import { AnalysisController } from '../analysis/analysis.controller';
import { CriterionTemplateController } from '../analysis/criterion-template.controller';
import { AuthController } from '../auth/auth.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DocumentsController } from '../documents/documents.controller';
import { DeliverableController } from '../domain/deliverable/deliverable.controller';
import { DossierController } from '../domain/dossier/dossier.controller';
import { MailController } from '../domain/mail/mail.controller';
import { InstructionsController } from '../instructions/instructions.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { CanalController } from '../referentials/canal/canal.controller';
import { CategoryController } from '../referentials/category/category.controller';
import { CompanyController } from '../referentials/company/company.controller';
import { ContractController } from '../referentials/contract/contract.controller';
import { ContractTypeController } from '../referentials/contract-type/contract-type.controller';
import { CorrespondantController } from '../referentials/correspondent/correspondent.controller';
import { CorrespondentTypeController } from '../referentials/correspondent-type/correspondent-type.controller';
import { CourrierNatureController } from '../referentials/courrier-nature/courrier-nature.controller';
import { DossierTypeController } from '../referentials/dossier-type/dossier-type.controller';
import { EffetTypeController } from '../referentials/effet-type/effet-type.controller';
import { ProjectController } from '../referentials/project/project.controller';
import { SupportController } from '../support/support.controller';
import { type McpTool, ToolDomain, ToolLevel } from './mcp-tool';

/** The domain of a tool, by the controller of its route. */
const TOOL_DOMAINS = new Map<Type<unknown>, ToolDomain>([
  [AuthController, ToolDomain.CORE],
  [NotificationsController, ToolDomain.CORE],
  [DocumentsController, ToolDomain.CORE],
  [SupportController, ToolDomain.CORE],
  [MailController, ToolDomain.MAIL],
  [InstructionsController, ToolDomain.INSTRUCTIONS],
  [DeliverableController, ToolDomain.INSTRUCTIONS],
  [AnalysisController, ToolDomain.ANALYSIS],
  [CriterionTemplateController, ToolDomain.ANALYSIS],
  [ProjectController, ToolDomain.PROJECTS],
  [ContractController, ToolDomain.PROJECTS],
  [DossierController, ToolDomain.PROJECTS],
  [CorrespondantController, ToolDomain.REFERENTIALS],
  [CorrespondentTypeController, ToolDomain.REFERENTIALS],
  [CourrierNatureController, ToolDomain.REFERENTIALS],
  [CanalController, ToolDomain.REFERENTIALS],
  [CategoryController, ToolDomain.REFERENTIALS],
  [ContractTypeController, ToolDomain.REFERENTIALS],
  [DossierTypeController, ToolDomain.REFERENTIALS],
  [EffetTypeController, ToolDomain.REFERENTIALS],
  [DashboardController, ToolDomain.DASHBOARD],
  [UsersController, ToolDomain.ORGANIZATION],
  [RoleController, ToolDomain.ORGANIZATION],
  [PermissionController, ToolDomain.ORGANIZATION],
  [DelegationController, ToolDomain.ORGANIZATION],
  [CompanyController, ToolDomain.ORGANIZATION],
  [ActivityController, ToolDomain.ORGANIZATION],
  [SettingsController, ToolDomain.ORGANIZATION],
]);

/** A tool's own domain, else SETTINGS for every ADMIN tool, else its controller's, else CORE. */
export function domainOf(tool: McpTool): ToolDomain {
  if (tool.domain) return tool.domain;
  if (tool.level === ToolLevel.ADMIN) return ToolDomain.SETTINGS;
  return (tool.route && TOOL_DOMAINS.get(tool.route[0])) ?? ToolDomain.CORE;
}
