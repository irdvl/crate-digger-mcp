import { LogEntry } from '../types';

export class Logger {
  constructor(private jobId: string) {}

  info(stage: string, message: string, context?: Record<string, any>): void {
    this.log('info', stage, message, context);
  }

  warn(stage: string, message: string, context?: Record<string, any>): void {
    this.log('warn', stage, message, context);
  }

  error(stage: string, message: string, context?: Record<string, any>): void {
    this.log('error', stage, message, context);
  }

  private log(level: 'info' | 'warn' | 'error', stage: string, message: string, context?: Record<string, any>): void {
    const logEntry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      stage,
      jobId: this.jobId,
      message,
      ...context
    };

    // Format for Cloudflare Worker logs
    const logMessage = JSON.stringify(logEntry);

    switch (level) {
      case 'info':
        console.log(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'error':
        console.error(logMessage);
        break;
    }
  }

  // Create a child logger with additional context
  child(additionalContext: Record<string, any>): Logger {
    const childLogger = new Logger(this.jobId);
    // Note: In a more sophisticated implementation, we could pass context through
    // For now, we'll keep it simple and just use the same jobId
    return childLogger;
  }

  // Log with duration tracking
  time<T>(stage: string, operation: () => Promise<T>): Promise<T> {
    const startTime = Date.now();
    this.info(stage, 'Operation started');

    return operation()
      .then(result => {
        const duration = Date.now() - startTime;
        this.info(stage, 'Operation completed', { duration });
        return result;
      })
      .catch(error => {
        const duration = Date.now() - startTime;
        this.error(stage, 'Operation failed', { duration, error: error.message });
        throw error;
      });
  }
}