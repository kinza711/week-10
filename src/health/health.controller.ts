import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  async check(@Res() res: Response) {
    let dbHealthy = true;
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      dbHealthy = false;
    }

    const body = {
      status: dbHealthy ? 'ok' : 'error',
      checks: {
        app: 'ok',
        database: dbHealthy ? 'ok' : 'error',
      },
    };

    res.status(dbHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json(body);
  }
}