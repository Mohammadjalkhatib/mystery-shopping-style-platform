import { Module, type DynamicModule } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

@Module({})
class TestConnectionModule {}

/**
 * Make a test's mongodb-memory-server connection visible the way the real app's is.
 *
 * In production `MongooseModule.forRoot` registers a GLOBAL core module, which is why a
 * `forFeature` anywhere in the tree can resolve the connection. A spec that only puts
 * `{ provide: getConnectionToken(), useValue: conn }` in its own `providers` array does not
 * reproduce that: the provider is scoped to the testing module, so any imported module that
 * declares its own models -- `AuthModule` does, since D-037 -- fails to resolve with
 * "Nest can't resolve dependencies of the UserModel".
 *
 * Importing this instead makes the connection global for the test, which is the shape the
 * application actually runs in.
 */
export function testDbModule(conn: Connection): DynamicModule {
  return {
    module: TestConnectionModule,
    global: true,
    providers: [{ provide: getConnectionToken(), useValue: conn }],
    exports: [getConnectionToken()],
  };
}
