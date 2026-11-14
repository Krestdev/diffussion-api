import {
  PermissionCode,
  PLATFORM_PERMISSIONS,
} from '../../auth/rbac/rbac.constants';

/**
 * The roles every new site starts with (the site then adds its own).
 * "Admin" has every permission a site role may carry — the platform-only
 * ones (PLATFORM_PERMISSIONS) only ever work through a global grant.
 */
export const DEFAULT_SITE_ROLES: {
  name: string;
  description: string;
  permissions: PermissionCode[];
  /** Given to the site's responsible when the site is created. */
  forResponsible?: boolean;
}[] = [
  {
    name: 'Admin',
    description: 'Toutes les permissions du site',
    permissions: Object.values(PermissionCode).filter(
      (code) => !PLATFORM_PERMISSIONS.has(code),
    ),
    forResponsible: true,
  },
  {
    name: 'Réceptionniste',
    description:
      'Enregistre et corrige les effets entrants ; peut proposer un dispatching',
    permissions: [
      PermissionCode.CourrierRead,
      PermissionCode.ContractRead,
      PermissionCode.CorrespondentRead,
      PermissionCode.ProjectRead,
      PermissionCode.CourrierRegisterEntrant,
      PermissionCode.CourrierUpdateDraft,
      PermissionCode.DossierRead,
    ],
  },
  {
    name: 'Dispatcher',
    description: 'Dispatche les effets entrants (transmis directement)',
    permissions: [
      PermissionCode.CourrierRead,
      PermissionCode.ContractRead,
      PermissionCode.CorrespondentRead,
      PermissionCode.ProjectRead,
      PermissionCode.DossierRead,
      PermissionCode.CourrierDispatch,
    ],
  },
  {
    name: 'Admin dispatcher',
    description:
      'Dispatche, valide les dispatchings proposés et corrige les effets entrants',
    permissions: [
      PermissionCode.CourrierRead,
      PermissionCode.ContractRead,
      PermissionCode.CorrespondentRead,
      PermissionCode.ProjectRead,
      PermissionCode.DossierRead,
      PermissionCode.CourrierDispatch,
      PermissionCode.CourrierDispatchValidate,
      PermissionCode.CourrierUpdate,
    ],
  },
];
