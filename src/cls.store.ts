import { ClsStore } from 'nestjs-cls';

export interface AppClsStore extends ClsStore {
  requestId: string;
  userId?: string;
  actorLabel?: string;
  parentLogId?: string;
  /** The client's IP address, for the audit journal. */
  ip?: string;
  /** The signed-in person's permission codes in their company (CoreAuthGuard, AppAdminGuard). */
  permissions?: readonly string[];
  /** Their company. */
  companyId?: string;
  /** A Diffusion super-administrator (profile SUPER_ADMIN). */
  platformAdmin?: boolean;
  /** A call from the core's console (app-admin API): who acts there. */
  coreActor?: { name: string; platform: boolean };
}
