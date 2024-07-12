import pino from 'pino';
const transport = pino.transport({
  targets: [
    {
      level: 'trace',
      target: 'pino-pretty',
      options: {
        colorize: true,
        customColors: 'warn:red,info:blue,error:red',
      },
    },
  ],
});
export const logger = pino(
  {
    level: 'trace',
    redact: ['poolKeys'],
    serializers: {
      error: pino.stdSerializers.err,
    },
    base: undefined,
  },
  transport,
);

