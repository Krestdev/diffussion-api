import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, NotFoundException } from '@nestjs/common';
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

// Thin wrapper around RustFS (S3-compatible object storage) so other
// modules can upload/download/delete files without touching the AWS SDK
// directly. Configured entirely from RUSTFS_* env vars.
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = requireEnv('RUSTFS_BUCKET');
    this.client = new S3Client({
      endpoint: requireEnv('RUSTFS_ENDPOINT'),
      region: process.env.RUSTFS_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: requireEnv('RUSTFS_ACCESS_KEY'),
        secretAccessKey: requireEnv('RUSTFS_SECRET_KEY'),
      },
    });
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
      this.client,
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
