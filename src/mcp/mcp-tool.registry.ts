import {
  type CallHandler,
  ForbiddenException,
  Inject,
  Injectable,
  type NestInterceptor,
  OnModuleInit,
  Optional,
  type Type,
} from '@nestjs/common';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { ModuleRef, Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { from, lastValueFrom, mergeAll, type Observable, of } from 'rxjs';
import { AccessService } from '../auth/access/access.service';
import {
  ANY_PERMISSIONS_KEY,
  APP_ADMIN_KEY,
  type CompanySource,
  PERMISSIONS_KEY,
  PLATFORM_ADMIN_KEY,
  SAME_COMPANY_KEY,
} from '../auth/access/decorators';
import { forbidden } from '../auth/access/permissions.guard';
import type { Permission } from '../auth/permissions';
import type { AuthUser } from '../auth/types/auth-user.type';
import { AppConfigService } from '../config/app-config.service';
import {
  type McpRequest,
  type McpTool,
  type ToolContext,
  validationFailed,
} from './mcp-tool';
import { routeArgs } from './route-args';
import { changeOf } from '../realtime/changes';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { domainOf } from './tool-domains';

/** The tools the endpoint offers (MCP_TOOLS in the app; a test list in unit tests). */
export const MCP_TOOL_LIST = Symbol('MCP_TOOL_LIST');

type Rule = {
  all?: string[];
  any?: string[];
  platformAdmin?: boolean;
  appAdmin?: boolean;
  sameCompany?: CompanySource[];
};

type InterceptorRef = Type<NestInterceptor> | NestInterceptor;

/**
 * Multer's FileInterceptor / FilesInterceptor / FileFieldsInterceptor: tools send JSON, never
 * multipart, so these are skipped. Nest's `mixin()` gives their classes a random name, so they
 * are recognised by their code (the multer instance they build), not by name.
 */
function isUploadInterceptor(ref: InterceptorRef): boolean {
  const type: unknown = typeof ref === 'function' ? ref : ref.constructor;
  const source = String(Function.prototype.toString.call(type));
  return /\bmulter\b/i.test(source);
}

/**
 * The catalogue of MCP tools, and who may use which. A tool calls REST handlers directly, so
 * what PermissionsGuard would check (permissions, platform administrator, same company) is
 * checked here, on every call: a tool can never see or do more than the route it stands for.
 */
@Injectable()
export class McpToolRegistry implements OnModuleInit {
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
    private readonly access: AccessService,
    @Inject(MCP_TOOL_LIST) private readonly tools: readonly McpTool[],
    // A change made by the assistant shows live in the company's tabs (optional in unit tests).
    @Optional() private readonly realtime?: RealtimeGateway,
  ) {}

  /** Fails at boot when a tool is misnamed or points at a handler that no longer exists. */
  onModuleInit(): void {
    const names = new Set<string>();
    for (const tool of this.tools) {
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name) || names.has(tool.name)) {
        throw new Error(`MCP tool name invalid or repeated: ${tool.name}`);
      }
      names.add(tool.name);
      if (tool.route) {
        this.handler(tool.route[0], tool.route[1]);
        if (this.rule(tool.route[0], tool.route[1]).appAdmin) {
          throw new Error(
            `MCP tool ${tool.name}: ${tool.route[0].name}.${tool.route[1]} is an app-admin route`,
          );
        }
      }
      tool.domain = domainOf(tool);
    }
    for (const tool of this.tools) {
      if (tool.preview && !names.has(tool.preview)) {
        throw new Error(
          `MCP tool ${tool.name}: unknown preview ${tool.preview}`,
        );
      }
    }
  }

  get enabled(): boolean {
    return this.config.get('MCP_TOOL_LEVELS').length > 0;
  }

  /** The tools this user may call, at the levels switched on. */
  forUser(user: AuthUser): McpTool[] {
    const levels: readonly string[] = this.config.get('MCP_TOOL_LEVELS');
    return this.tools.filter(
      (tool) =>
        levels.includes(tool.level) &&
        (!tool.visibleTo ||
          tool.visibleTo.some((p) => user.permissions.has(p))) &&
        (!tool.route ||
          this.allows(user, this.rule(tool.route[0], tool.route[1]))),
    );
  }

  /** What a tool gets to run as the request's user. */
  context(request: McpRequest & { user: AuthUser }): ToolContext {
    const user = request.user;
    return {
      user,
      request,
      call: async (type, method, ...args) => {
        const handler = this.handler(type, method);
        await this.authorize(user, type, method, args);
        const controller = this.moduleRef.get(type, { strict: false });
        const result = (await handler.apply(controller, args)) as unknown;
        this.announce(user, type, method, handler, args);
        return (await this.intercept(
          type,
          method,
          handler,
          request,
          result,
        )) as never;
      },
      dto: async (type, plain) => toDto(type, plain),
      can: (permission: Permission) => user.permissions.has(permission),
    };
  }

  /**
   * A change made by the assistant shows live in the company's tabs, like one made in the UI
   * (ChangesInterceptor), marked as the assistant's (as EXPENZO's registry).
   */
  private announce(
    user: AuthUser,
    type: Type<unknown>,
    method: string,
    handler: (...args: unknown[]) => unknown,
    args: unknown[],
  ): void {
    if (!this.realtime) return;
    const params: Record<string, unknown> = {};
    for (const arg of routeArgs(type, method)) {
      if (arg.kind === 'param') params[arg.name] = args[arg.index];
    }
    const found = changeOf(type, handler, params, {
      by: user.sub,
      viaAssistant: true,
    });
    if (found) {
      this.realtime.publish(user.companyId, found.change, found.personal);
    }
  }

  /** PermissionsGuard's checks, on the arguments the handler is about to get. */
  private async authorize(
    user: AuthUser,
    type: Type<unknown>,
    method: string,
    args: unknown[],
  ): Promise<void> {
    const rule = this.rule(type, method);
    if (rule.appAdmin) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Reserved to the CREAPP console',
      });
    }
    const missing = rule.all?.find((p) => !user.permissions.has(p));
    if (missing) throw forbidden(missing);
    if (rule.any?.length && !rule.any.some((p) => user.permissions.has(p))) {
      throw forbidden(rule.any[0]);
    }
    if (rule.platformAdmin && !user.platformAdmin) {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_ONLY',
        message:
          'Reserved to a Diffusion super-administrator: this is common to every company',
      });
    }
    if (!rule.sameCompany) return;
    const given = routeArgs(type, method);
    for (const source of rule.sameCompany) {
      let id: unknown;
      if ('param' in source) {
        const param = given.find(
          (a) => a.kind === 'param' && a.name === source.param,
        );
        id = param ? args[param.index] : undefined;
      } else {
        for (const arg of given) {
          if (arg.kind !== 'body') continue;
          const value = args[arg.index];
          if (arg.field === source.body) id = value;
          else if (!arg.field && value && typeof value === 'object') {
            id = (value as Record<string, unknown>)[source.body];
          }
          if (id !== undefined) break;
        }
      }
      if (typeof id === 'string' && id) {
        await this.access.assertSameCompany(user.sub, source.entity, id);
      }
    }
  }

  /**
   * The handler's interceptors that shape its answer (e.g. LivrableHistoryInterceptor), as
   * Nest would run them; upload interceptors (multer) have nothing to do here.
   */
  private async intercept(
    type: Type<unknown>,
    method: string,
    handler: (...args: unknown[]) => unknown,
    request: McpRequest,
    result: unknown,
  ): Promise<unknown> {
    const refs = [
      ...((Reflect.getMetadata(INTERCEPTORS_METADATA, type) ??
        []) as InterceptorRef[]),
      ...((Reflect.getMetadata(INTERCEPTORS_METADATA, handler) ??
        []) as InterceptorRef[]),
    ].filter((ref) => !isUploadInterceptor(ref));
    if (!refs.length) return result;
    const context = new ExecutionContextHost(
      [request, request.res ?? {}, undefined],
      type,
      handler,
    );
    let next: CallHandler = { handle: () => of(result) };
    for (const ref of [...refs].reverse()) {
      const interceptor = this.interceptor(ref);
      const inner = next;
      next = {
        handle: () =>
          from(Promise.resolve(interceptor.intercept(context, inner))).pipe(
            mergeAll(),
          ) as Observable<unknown>,
      };
    }
    return lastValueFrom(next.handle(), { defaultValue: undefined });
  }

  private interceptor(ref: InterceptorRef): NestInterceptor {
    if (typeof ref !== 'function') return ref;
    try {
      const found = this.moduleRef.get<NestInterceptor>(ref, { strict: false });
      if (typeof found?.intercept === 'function') return found;
    } catch {
      // Not a provider: Nest makes such interceptors itself.
    }
    return new ref();
  }

  private handler(type: Type<unknown>, method: string) {
    const handler: unknown = (type.prototype as Record<string, unknown>)[
      method
    ];
    if (typeof handler !== 'function') {
      throw new Error(`MCP tool route missing: ${type.name}.${method}`);
    }
    return handler as (...args: unknown[]) => unknown;
  }

  /** The route's access decorators, method first then class (as the guards read them). */
  private rule(type: Type<unknown>, method: string): Rule {
    const targets = [this.handler(type, method), type];
    return {
      all: this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets),
      any: this.reflector.getAllAndOverride<string[]>(
        ANY_PERMISSIONS_KEY,
        targets,
      ),
      platformAdmin: this.reflector.getAllAndOverride<boolean>(
        PLATFORM_ADMIN_KEY,
        targets,
      ),
      appAdmin: this.reflector.getAllAndOverride<boolean>(
        APP_ADMIN_KEY,
        targets,
      ),
      sameCompany: this.reflector.getAllAndOverride<CompanySource[]>(
        SAME_COMPANY_KEY,
        targets,
      ),
    };
  }

  private allows(user: AuthUser, rule: Rule): boolean {
    const has = (p: string) => user.permissions.has(p);
    return (
      !rule.appAdmin &&
      (!rule.platformAdmin || user.platformAdmin) &&
      (rule.all ?? []).every(has) &&
      (!rule.any?.length || rule.any.some(has))
    );
  }
}

/** The REST validation pipe's rules: whitelist, no unknown field, class-transformer types. */
async function toDto<T extends object>(
  type: Type<T>,
  plain: object,
): Promise<T> {
  const defined = Object.fromEntries(
    Object.entries(plain).filter(([, value]) => value !== undefined),
  );
  const dto = plainToInstance(type, defined);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    throw validationFailed(
      errors.map((error) => error.property),
      errors.flatMap((error) => Object.values(error.constraints ?? {})),
    );
  }
  return dto;
}
