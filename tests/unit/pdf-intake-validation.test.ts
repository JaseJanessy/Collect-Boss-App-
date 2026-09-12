import { describe, expect, it } from 'vitest';

import { inspectPdfBytes, validatePdfFileMetadata } from '../../shared/pdf-intake';
import { validateDocumentUpload } from '@/lib/document-intake/validation';

const encoder = new TextEncoder();

function pdfBytes(extra = '') {
  const body = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R ${extra}>>\nendobj\n`;
  const xrefOffset = encoder.encode(body).length;
  return encoder.encode(`${body}xref\n0 4\n0000000000 65535 f \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
}

describe('PDF transaction intake validation', () => {
  it('accepts a readable PDF and reports its page count and SHA-256', () => {
    const bytes = pdfBytes();
    const inspection = inspectPdfBytes(bytes);
    expect(inspection).toMatchObject({ valid: true, pageCount: 1, pdfVersion: '1.4' });
    const file = new File([bytes], 'transaction.pdf', { type: 'application/pdf' });
    const result = validateDocumentUpload(file, bytes);
    expect(result).toMatchObject({ extension: 'pdf', magicMimeType: 'application/pdf', pageCount: 1 });
    expect('sha256' in result && result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects wrong extension, MIME mismatch, empty and oversized metadata safely', () => {
    expect(validatePdfFileMetadata({ name: 'transaction.png', mimeType: 'application/pdf', size: 12 })?.valid).toBe(false);
    expect(validatePdfFileMetadata({ name: 'transaction.pdf', mimeType: 'image/png', size: 12 })?.valid).toBe(false);
    expect(validatePdfFileMetadata({ name: 'transaction.pdf', mimeType: 'application/pdf', size: 0 })).toMatchObject({ code: 'PDF_EMPTY' });
    expect(validatePdfFileMetadata({ name: 'transaction.pdf', mimeType: 'application/pdf', size: 11, limits: { maxBytes: 10, maxPages: 100 } })).toMatchObject({ code: 'PDF_TOO_LARGE' });
  });

  it('rejects invalid magic bytes, encrypted files and corrupt structures', () => {
    expect(inspectPdfBytes(encoder.encode('not a pdf'))).toMatchObject({ code: 'PDF_CORRUPT' });
    expect(inspectPdfBytes(pdfBytes('/Encrypt 9 0 R '))).toMatchObject({ code: 'PDF_ENCRYPTED' });
    const corrupt = pdfBytes().subarray(0, pdfBytes().length - 8);
    expect(inspectPdfBytes(corrupt)).toMatchObject({ code: 'PDF_CORRUPT' });
  });

  it('enforces the centrally supplied page limit', () => {
    const bytes = pdfBytes(`${'/Type /Page '.repeat(3)}`);
    expect(inspectPdfBytes(bytes, { maxBytes: 10_000, maxPages: 3 })).toMatchObject({ code: 'PDF_TOO_MANY_PAGES' });
  });
});
