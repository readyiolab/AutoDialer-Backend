import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { LeadSource } from '@prisma/client';

@Injectable()
export class ImportProcessor {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  async process(job: Job<{ importHistoryId: string; companyId: string }>) {
    return this.commitImport(job.data.importHistoryId, job.data.companyId);
  }

  async commitImport(importHistoryId: string, companyId: string) {
    const history = await this.prisma.importHistory.findFirst({
      where: { id: importHistoryId, companyId },
    });

    if (!history) {
      throw new Error('Import history not found');
    }

    if (history.status === 'CANCELLED') {
      return { cancelled: true };
    }

    if (history.status === 'COMPLETED') {
      return { alreadyCompleted: true };
    }

    const staged = (history.stagedRows as any[]) || [];
    if (!staged.length) {
      await this.prisma.importHistory.update({
        where: { id: importHistoryId },
        data: { status: 'FAILED', progress: 100, completedAt: new Date() },
      });
      return { imported: 0 };
    }

    const mobiles = staged.map((r) => r.mobileNumber).filter(Boolean);
    const existing = await this.prisma.lead.findMany({
      where: { companyId, mobileNumber: { in: mobiles } },
      select: { mobileNumber: true },
    });
    const existingSet = new Set(existing.map((e) => e.mobileNumber));

    const toInsert = staged.filter((r) => r.mobileNumber && !existingSet.has(r.mobileNumber));
    const skippedDupes = staged.length - toInsert.length;

    const chunkSize = 200;
    let imported = 0;

    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      await this.prisma.lead.createMany({
        data: chunk.map((r) => ({
          customerName: r.customerName,
          mobileNumber: r.mobileNumber,
          email: r.email || null,
          city: r.city || null,
          state: r.state || null,
          address: r.address || null,
          loanAmount: r.loanAmount != null ? r.loanAmount : null,
          product: r.product || null,
          employer: r.employer || null,
          customFields: r.customFields || {},
          source: LeadSource.EXCEL_UPLOAD,
          status: 'NEW',
          campaignId: history.campaignId || null,
          companyId,
          importHistoryId,
          consentGiven: !!r.consentGiven,
        })),
        skipDuplicates: true,
      });
      imported += chunk.length;
      const progress = Math.min(99, Math.round((imported / Math.max(toInsert.length, 1)) * 100));
      await this.prisma.importHistory.update({
        where: { id: importHistoryId },
        data: { progress, importedRecords: imported },
      });
    }

    if (history.rejectedFileUrl == null && staged.length) {
      // keep existing rejected file if any
    }

    await this.prisma.importHistory.update({
      where: { id: importHistoryId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        importedRecords: imported,
        duplicateRecords: history.duplicateRecords + skippedDupes,
        stagedRows: [],
        completedAt: new Date(),
      },
    });

    this.logger.log(`Import ${importHistoryId} completed: ${imported} leads`);
    return { imported, duplicates: skippedDupes };
  }

  writeRejectedFile(rejected: any[], importId: string): string | null {
    if (!rejected.length) return null;
    const dir = process.env.UPLOAD_DIR || './uploads';
    const rejectedDir = path.join(dir, 'rejected');
    fs.mkdirSync(rejectedDir, { recursive: true });
    const filePath = path.join(rejectedDir, `${importId}-rejected.xlsx`);
    const sheet = xlsx.utils.json_to_sheet(rejected);
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, sheet, 'Rejected');
    xlsx.writeFile(book, filePath);
    return filePath;
  }
}
