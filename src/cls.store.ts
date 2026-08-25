import { ClsStore } from 'nestjs-cls';

export interface AppClsStore extends ClsStore {
  requestId: string;
  userId?: string;
  actorLabel?: string;
  parentLogId?: string;
}
