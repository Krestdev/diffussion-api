import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { extname } from 'path';
import { memoryStorage } from 'multer';

/** Largest attachment accepted, per file. */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

/** The attachments accepted: PDF, JPG, PNG, TIFF, DOCX, XLSX, EML, MSG, MP4. */
export const ATTACHMENT_EXTENSIONS = [
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
  '.docx',
  '.xlsx',
  '.eml',
  '.msg',
  '.mp4',
] as const;

export const ATTACHMENT_RULE =
  'PDF, JPG, PNG, TIFF, DOCX, XLSX, EML, MSG ou MP4 — 100 Mo max par fichier';

// Checked on the extension: EML and MSG files come with too many different
// MIME types (or none) to be told apart by it.
export function isAcceptedAttachment(originalName: string): boolean {
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(
    extname(originalName).toLowerCase(),
  );
}

/** Multer options for attachments: in memory, 100 MB, accepted types only. */
export function attachmentUploadOptions(maxFiles?: number): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: {
      fileSize: ATTACHMENT_MAX_BYTES,
      ...(maxFiles ? { files: maxFiles } : {}),
    },
    fileFilter: (_req, file, callback) => {
      if (isAcceptedAttachment(file.originalname)) {
        callback(null, true);
        return;
      }
      callback(
        new BadRequestException(
          `Type de fichier refusé (${file.originalname}) : ${ATTACHMENT_RULE}`,
        ),
        false,
      );
    },
  };
}
