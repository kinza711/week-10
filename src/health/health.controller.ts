import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';

const DB_CHECK_TIMEOUT_MS = 2000;

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async check(@Res() res: Response) {
    const dbCheck = await this.checkDatabase();

    const allHealthy = dbCheck.status === 'ok';
    const body = {
      status: allHealthy ? 'ok' : 'error',
      checks: {
        app: 'ok',
        database: dbCheck.status,
      },
    };

    res
      .status(allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
      .json(body);
  }

  private async checkDatabase(): Promise<{ status: 'ok' | 'error' }> {
    const timeout = new Promise<{ status: 'error' }>((resolve) =>
      setTimeout(() => resolve({ status: 'error' }), DB_CHECK_TIMEOUT_MS),
    );

    const query = this.dataSource
      .query('SELECT 1')
      .then(() => ({ status: 'ok' as const }))
      .catch(() => ({ status: 'error' as const }));

    return Promise.race([query, timeout]);
  }
}