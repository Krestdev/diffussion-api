import { diffEntity, snapshotCreate, snapshotDelete } from '../../common/utils/diff-entity.util';

export interface AuditLogOptions {
  action: string;
  entityType: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  idParamIndex?: number; // Index of the ID in the arguments array (default: 0)
  findMethod?: string; // Name of the method used to fetch the entity (default: 'findOne')
}

/**
 * Method decorator to automatically create an ActivityLog entry before and after 
 * a service method executes.
 * 
 * IMPORTANT: The class using this decorator MUST have `ActivityService` injected 
 * as `this.activity`. For UPDATE and DELETE operations, the class MUST also have 
 * a method to fetch the entity before it changes (defaults to `this.findOne(id)`).
 */
export function AuditLog(options: AuditLogOptions) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      // @ts-ignore - we assume the class has activity injected
      const activityService = this.activity;
      if (!activityService) {
        throw new Error(`@AuditLog requires an "activity" property (ActivityService) on ${target.constructor.name}`);
      }

      const id = args[options.idParamIndex ?? 0];
      const findMethodName = options.findMethod ?? 'findOne';

      let before: Record<string, unknown> | null = null;

      // 1. For UPDATE or DELETE, we must fetch the "before" snapshot
      if (options.operation === 'UPDATE' || options.operation === 'DELETE') {
        // @ts-ignore
        if (typeof this[findMethodName] !== 'function') {
          throw new Error(`@AuditLog requires a ${findMethodName}() method on ${target.constructor.name} to fetch the 'before' state.`);
        }
        // @ts-ignore
        before = await this[findMethodName](id);
      }

      // 2. Execute the original database operation
      const result = await originalMethod.apply(this, args);

      // 3. Determine "after" state and compute changes
      let changes: Record<string, [unknown, unknown]> | null = null;
      let entityId = null;

      if (options.operation === 'CREATE') {
        // Assume create() returns the newly created entity
        entityId = result?.id ?? id;
        changes = snapshotCreate(result ?? {});
      } else if (options.operation === 'UPDATE') {
        // Assume update() returns the updated entity
        entityId = id;
        changes = diffEntity(before ?? {}, result ?? {});
      } else if (options.operation === 'DELETE') {
        entityId = id;
        changes = snapshotDelete(before ?? {});
      }

      // 4. Record the log
      await activityService.record({
        action: options.action,
        entityType: options.entityType,
        entityId,
        changes: changes ?? undefined,
      });

      return result;
    };

    return descriptor;
  };
}
