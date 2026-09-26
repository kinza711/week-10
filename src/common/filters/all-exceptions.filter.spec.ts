import { ArgumentsHost, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost(request: Record<string, unknown>) {
  const jsonMock = jest.fn();
  const statusMock = jest.fn(() => ({ json: jsonMock }));
  const response = { status: statusMock };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, statusMock, jsonMock };
}

describe('AllExceptionsFilter (Challenge X2: no secret leaks)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('a failed login logs the request body with the password redacted, not in cleartext', () => {
    const filter = new AllExceptionsFilter();
    const request = {
      url: '/auth/login',
      method: 'POST',
      body: { email: 'attacker@example.com', password: 'super-secret-plaintext' },
    };
    const { host, jsonMock } = makeHost(request);

    filter.catch(new UnauthorizedException('Invalid email or password'), host);

    expect(debugSpy).toHaveBeenCalledTimes(1);
    const loggedLine = debugSpy.mock.calls[0][0] as string;

    expect(loggedLine).not.toContain('super-secret-plaintext');
    expect(loggedLine).toContain('[REDACTED]');

    // And the response body never had the password in it either -
    // UnauthorizedException's own payload never carried it, but this
    // confirms the filter doesn't introduce it from the request either.
    const responseBody = JSON.stringify(jsonMock.mock.calls[0][0]);
    expect(responseBody).not.toContain('super-secret-plaintext');
  });

  it('redacts a refresh token the same way, wherever it appears in the request body', () => {
    const filter = new AllExceptionsFilter();
    const request = {
      url: '/auth/refresh',
      method: 'POST',
      body: { refreshToken: 'abc123-very-real-refresh-token' },
    };
    const { host } = makeHost(request);

    filter.catch(new UnauthorizedException('Invalid refresh token'), host);

    const loggedLine = debugSpy.mock.calls[0][0] as string;
    expect(loggedLine).not.toContain('abc123-very-real-refresh-token');
    expect(loggedLine).toContain('[REDACTED]');
  });

  it('a genuinely unexpected error never leaks a stack trace to the client', () => {
    process.env.NODE_ENV = 'production';
    const filter = new AllExceptionsFilter();
    const request = { url: '/projects', method: 'POST', body: {} };
    const { host, jsonMock, statusMock } = makeHost(request);

    const dbError = new Error(
      'password authentication failed for user "app_user" at connection string postgres://app_user:hunter2@db-host:5432/prod',
    );
    filter.catch(dbError, host);

    expect(statusMock).toHaveBeenCalledWith(500);
    const responseBody = jsonMock.mock.calls[0][0];
    expect(responseBody.message).toBe('Internal server error'); // generic in production
    expect(JSON.stringify(responseBody)).not.toContain('hunter2');
    expect(JSON.stringify(responseBody)).not.toContain('at ');  // no stack-frame shape
  });

  it('the server log still gets the full detail (for the 500 case), even though the client does not', () => {
    process.env.NODE_ENV = 'production';
    const filter = new AllExceptionsFilter();
    const request = { url: '/projects', method: 'POST', body: {} };
    const { host } = makeHost(request);

    filter.catch(new Error('a real bug, worth seeing in the logs'), host);

    expect(errorSpy).toHaveBeenCalled();
    const [loggedLine, stack] = errorSpy.mock.calls[0];
    expect(loggedLine).toContain('a real bug, worth seeing in the logs');
    expect(stack).toBeDefined(); // the stack trace goes to the log, never the response
  });
});


describe('AllExceptionsFilter (Challenge X3: dev vs production detail)', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('the identical unexpected error returns different detail depending on NODE_ENV', () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const makeError = () => new Error('column "foo" does not exist in table "bar"');

    // Same failure, development: the specific message reaches the client.
    process.env.NODE_ENV = 'development';
    const devFilter = new AllExceptionsFilter();
    const devRequest = { url: '/tasks', method: 'GET', body: {} };
    const { host: devHost, jsonMock: devJson } = makeHost(devRequest);
    devFilter.catch(makeError(), devHost);
    const devBody = devJson.mock.calls[0][0];

    // The identical failure, production: only the generic message.
    process.env.NODE_ENV = 'production';
    const prodFilter = new AllExceptionsFilter();
    const prodRequest = { url: '/tasks', method: 'GET', body: {} };
    const { host: prodHost, jsonMock: prodJson } = makeHost(prodRequest);
    prodFilter.catch(makeError(), prodHost);
    const prodBody = prodJson.mock.calls[0][0];

    expect(devBody.message).toContain('column "foo" does not exist');
    expect(prodBody.message).toBe('Internal server error');
    expect(prodBody.message).not.toContain('column');
    expect(prodBody.message).not.toContain('foo');

    // Both environments still log the same full detail server-side -
    // this is about what the *client* sees, not what gets recorded.
    expect(errorSpy).toHaveBeenCalledTimes(2);
    for (const [loggedLine] of errorSpy.mock.calls) {
      expect(loggedLine).toContain('does not exist in table');
    }

    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('an expected HttpException (e.g. a 404) is unaffected by NODE_ENV - it was never generic to begin with', () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    for (const env of ['development', 'production']) {
      process.env.NODE_ENV = env;
      const filter = new AllExceptionsFilter();
      const request = { url: '/projects/x', method: 'GET', body: {} };
      const { host, jsonMock } = makeHost(request);

      filter.catch(new NotFoundException('Project not found'), host);

      expect(jsonMock.mock.calls[0][0].message).toBe('Project not found');
    }

    debugSpy.mockRestore();
  });
});
