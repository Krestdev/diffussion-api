import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

export type UploadResult = {
  key: string;
  bucket: string;
};

export type DownloadResult = {
  body: Readable;
  contentType?: string;
  contentLength?: number;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Thin wrapper around the S3-compatible document storage (dochub) so other
// modules can upload/download/delete files without touching the AWS SDK
// directly. Configured from the S3_* env vars, named as in EXPENZO:
// S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_ACCESS_KEY_ID,
// S3_SECRET_ACCESS_KEY, S3_KEY_PREFIX (this environment's folder in a shared
// bucket) and, optionally, S3_PUBLIC_ENDPOINT (the address browsers use, when
// it differs from the API's).
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  private readonly keyPrefix: string;

  constructor() {
    this.bucket = requireEnv('S3_BUCKET');
    this.keyPrefix = (process.env.S3_KEY_PREFIX ?? '').replace(
      /^\/+|\/+$/g,
      '',
    );
    const credentials = {
      accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
    };
    const region = process.env.S3_REGION || 'us-east-1';
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false';
    // The SDK's default flexible checksums (CRC32 on every request and
    // response) are not understood by every S3-compatible storage: send and
    // check them only when the operation requires one.
    const checksumConfig = {
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    this.client = new S3Client({
      endpoint: requireEnv('S3_ENDPOINT'),
      region,
      forcePathStyle,
      credentials,
      ...checksumConfig,
    });
    // Presigned URLs must be signed with the endpoint the client will actually
    // call — the host is part of the signature. Use a dedicated client pointed
    // at the public endpoint when one is configured.
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT;
    this.publicClient = publicEndpoint
      ? new S3Client({
          endpoint: publicEndpoint,
          region,
          forcePathStyle,
          credentials,
          ...checksumConfig,
        })
      : this.client;
  }

  /**
   * Creates the bucket on a fresh storage so the first upload doesn't fail
   * with NoSuchBucket. Never blocks startup: if the storage is down, the rest of
   * the API still works and only file routes fail — logged here so the
   * cause is obvious instead of a bare ECONNREFUSED on the first upload.
   */
  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 404) {
        this.logger.warn(
          `Object storage unreachable at ${process.env.S3_ENDPOINT} (${(error as Error).name || 'connection error'}) — file uploads/downloads will fail until it is reachable`,
        );
        return;
      }
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created storage bucket "${this.bucket}"`);
      } catch (createError) {
        this.logger.warn(
          `Could not create storage bucket "${this.bucket}": ${(createError as Error).message}`,
        );
      }
    }
  }

  async upload(
    buffer: Buffer,
    options: { originalName: string; contentType?: string; prefix?: string },
  ): Promise<UploadResult> {
    const key = this.buildKey(options.originalName, options.prefix);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: options.contentType,
      }),
    );
    return { key, bucket: this.bucket };
  }

  async download(key: string): Promise<DownloadResult> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        body: result.Body as Readable,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (error) {
      throw this.mapNotFound(key, error);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getSignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  private buildKey(originalName: string, prefix?: string): string {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const folder = prefix ? `${prefix.replace(/\/+$/, '')}/` : '';
    return `${folder}${randomUUID()}-${safeName}`;
  }

  private mapNotFound(key: string, error: unknown): unknown {
    const code = (error as { name?: string })?.name;
    if (code === 'NoSuchKey' || code === 'NotFound') {
      return new NotFoundException(`File ${key} not found`);
    }
    return error;
  }
}
