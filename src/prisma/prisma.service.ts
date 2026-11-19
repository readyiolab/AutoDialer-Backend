import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { withRetry, isRetryableDbError } from '../common/utils/retry';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: ['warn', 'error'],
    });
  }

  async onModuleInit() {
    await withRetry(() => this.$connect(), { context: 'PRISMA_CONNECT' });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async withDbRetry<T>(operation: () => Promise<T>, context = 'PRISMA'): Promise<T> {
    return withRetry(operation, {
      context,
      retryIf: (error) => isRetryableDbError(error),
    });
  }

  async safeQuery<T>(operation: () => Promise<T>, context = 'PRISMA_QUERY'): Promise<T> {
    return this.withDbRetry(operation, context);
  }

  isTransientError(error: unknown): boolean {
    return isRetryableDbError(error);
  }

  isNonRetryableWriteError(error: unknown): boolean {
    const err = error as Prisma.PrismaClientKnownRequestError;
    return err?.code === 'P2002' || err?.code === 'P2003' || err?.code === 'P2025';
  }
}
