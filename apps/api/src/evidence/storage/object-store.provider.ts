import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { GridFsObjectStore } from './gridfs.store.js';
import { OBJECT_STORE, type ObjectStore } from './object-store.js';
import { S3ObjectStore } from './s3.store.js';

/**
 * Which backend evidence goes to, decided once at boot from config.
 *
 * S3 when every one of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` and
 * `S3_SECRET_ACCESS_KEY` is present; GridFS otherwise. ALL of them, deliberately: a half-set
 * of variables is a typo or a half-finished deployment, and silently falling back would put
 * production photos in MongoDB while the dashboard said MinIO. Falling back on ABSENCE is
 * intended; falling back on a partial config is how you lose data quietly.
 *
 * The choice is logged at boot, because "where are the photos" should never be a guess.
 */
export const objectStoreProvider = {
  provide: OBJECT_STORE,
  inject: [ConfigService, getConnectionToken()],
  useFactory: (config: ConfigService, connection: Connection): ObjectStore => {
    const logger = new Logger('ObjectStore');
    const endpoint = config.get<string>('S3_ENDPOINT');
    const bucket = config.get<string>('S3_BUCKET');
    const accessKeyId = config.get<string>('S3_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>('S3_SECRET_ACCESS_KEY');

    const provided = [endpoint, bucket, accessKeyId, secretAccessKey].filter(Boolean).length;
    if (provided === 4) {
      logger.log(`Evidence -> S3 at ${endpoint!}/${bucket!}`);
      return new S3ObjectStore({
        endpoint: endpoint!,
        bucket: bucket!,
        accessKeyId: accessKeyId!,
        secretAccessKey: secretAccessKey!,
        region: config.get<string>('S3_REGION') ?? 'auto',
        forcePathStyle: (config.get<string>('S3_FORCE_PATH_STYLE') ?? 'true') !== 'false',
      });
    }
    if (provided > 0) {
      // Loud, and still a fallback: refusing to boot would take the whole API down over a
      // feature that is optional, but this must never be silent.
      logger.error(
        `S3 is PARTIALLY configured (${provided}/4 variables). Falling back to GridFS. ` +
          'Set all of S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.',
      );
    } else {
      logger.log('Evidence -> MongoDB GridFS (no S3 configured)');
    }
    return new GridFsObjectStore(connection);
  },
};
