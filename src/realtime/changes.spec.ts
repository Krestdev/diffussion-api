import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { changeOf } from './changes';
import { ChangesInterceptor } from './changes.interceptor';

@Controller('courriers')
class Courriers {
  @Get() list() {}
  @Post() create() {}
  @Patch(':id') update(@Param('id') id: string) {
    return id;
  }
  @Post(':id/validate') validate(@Param('id') id: string) {
    return id;
  }
  @Delete(':id') remove(@Param('id') id: string) {
    return id;
  }
}

@Controller('notifications')
class Notifications {
  @Patch('read-all') readAll() {}
}

@Controller('settings')
class Settings {
  @Put('notifications') save() {}
}

@Controller('auth')
class Auth {
  @Post('logout') logout() {}
}

@Controller()
class AppAdmin {
  @Post('app-admin/roles') create() {}
}

const actor = { by: 'u1', clientId: 'tab' };
const of_ = (type: object, method: string, params?: Record<string, unknown>) =>
  changeOf(
    type as never,
    (type as { prototype: Record<string, () => void> }).prototype[method],
    params,
    actor,
  );

describe('changeOf', () => {
  it('reads domain, id and action from the route', () => {
    expect(of_(Courriers, 'create')?.change).toMatchObject({
      domain: 'courriers',
      resource: 'courriers',
      action: 'created',
      by: 'u1',
      clientId: 'tab',
    });
    expect(of_(Courriers, 'update', { id: 'c1' })?.change).toMatchObject({
      id: 'c1',
      action: 'updated',
    });
    expect(of_(Courriers, 'validate', { id: 'c1' })?.change).toMatchObject({
      id: 'c1',
      action: 'validate',
    });
    expect(of_(Courriers, 'remove', { id: 'c1' })?.change).toMatchObject({
      action: 'deleted',
    });
    expect(of_(Settings, 'save')?.change).toMatchObject({
      domain: 'settings',
      action: 'notifications',
    });
    expect(of_(AppAdmin, 'create')?.change).toMatchObject({
      domain: 'app-admin',
      action: 'roles',
    });
  });

  it('ignores reads and sessions; marks personal changes', () => {
    expect(of_(Courriers, 'list')).toBeNull();
    expect(of_(Auth, 'logout')).toBeNull();
    expect(of_(Notifications, 'readAll')).toMatchObject({ personal: true });
    expect(of_(Courriers, 'create')).toMatchObject({ personal: false });
  });
});

describe('ChangesInterceptor', () => {
  const run = async (method: string, user?: object) => {
    const realtime = { publish: jest.fn() };
    const interceptor = new ChangesInterceptor(realtime as never);
    const request = {
      method,
      params: { id: 'c1' },
      headers: { 'x-client-id': 'tab-1' },
      user,
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
      getClass: () => Courriers,
      getHandler: () =>
        Object.getOwnPropertyDescriptor(Courriers.prototype, 'validate')
          ?.value as unknown,
    };
    await lastValueFrom(
      interceptor.intercept(context as never, { handle: () => of('done') }),
    );
    return realtime.publish;
  };

  it("announces a signed-in person's change to their company, with their tab", async () => {
    const publish = await run('POST', { sub: 'u1', companyId: 'co1' });
    expect(publish).toHaveBeenCalledWith(
      'co1',
      expect.objectContaining({
        domain: 'courriers',
        id: 'c1',
        action: 'validate',
        by: 'u1',
        clientId: 'tab-1',
      }),
      false,
    );
  });

  it('says nothing for a read or without a signed-in person', async () => {
    expect(
      await run('GET', { sub: 'u1', companyId: 'co1' }),
    ).not.toHaveBeenCalled();
    expect(await run('POST')).not.toHaveBeenCalled();
  });
});
