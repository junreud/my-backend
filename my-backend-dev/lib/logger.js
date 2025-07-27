import SystemLog from '../models/SystemLog.js';

// 실행 환경 확인 - 브라우저인지 Node.js인지 구분
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// 콘솔 로거 생성 함수 추가
function createConsoleLogger(name) {
  return {
    debug(message, ...args) {
      console.debug(`[${name}] [DEBUG]`, message, ...args);
    },
    info(message, ...args) {
      console.info(`[${name}] [INFO]`, message, ...args);
    },
    warn(message, ...args) {
      console.warn(`[${name}] [WARN]`, message, ...args);
    },
    error(message, ...args) {
      console.error(`[${name}] [ERROR]`, message, ...args);
    }
  };
}

// 로그 레벨 우선순위
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// DB 로깅을 위한 큐 (비동기 처리용)
const loggingQueue = [];
let isProcessingQueue = false;

// 큐 처리 함수
async function processLoggingQueue() {
  if (isProcessingQueue || loggingQueue.length === 0) return;
  
  isProcessingQueue = true;
  const batch = loggingQueue.splice(0, Math.min(100, loggingQueue.length));
  
  try {
    await SystemLog.bulkCreate(batch);
  } catch (err) {
    // console.error('Failed to save logs to database:', err); // Avoid logging complex error objects directly to console in a way that might re-trigger issues
    console.error('Failed to save logs to database. Error message:', err.message); // Log only the error message
  } finally {
    isProcessingQueue = false;
    if (loggingQueue.length > 0) {
      setImmediate(processLoggingQueue);
    }
  }
}
// 로거 생성 함수
export function createLogger(name, options = {}) {
  const consoleLogger = createConsoleLogger(name);
  const { service = 'default', disableConsole = false } = options;
  
  // 성능 최적화를 위한 로그 레벨 사전 확인
  const dbLogLevel = process.env.DB_LOG_LEVEL || 'info';
  const levelPriority = { debug: 0, info: 1, warn: 2, error: 3 };
  
  return {
    debug(message, ...args) {
      // 콘솔 로깅
      if (!disableConsole) {
        consoleLogger.debug(message, ...args);
      }
      
      // DB 로깅 (debug 레벨 이상만)
      if (levelPriority['debug'] >= levelPriority[dbLogLevel]) {
        try {
          const details = args.length > 0 ? JSON.stringify(args, (key, value) => {
            if (value instanceof Error) {
              return { message: value.message, stack: value.stack, name: value.name };
            }
            if (typeof value === 'function') {
              return '[Function]';
            }
            // Add more checks for other complex types if necessary
            return value;
          }, 2) : null;
          loggingQueue.push({
            timestamp: new Date(),
            level: 'debug',
            logger: name,
            message: String(message),
            details,
            service
          });
          
          processLoggingQueue();
        } catch (err) {
          consoleLogger.error('Failed to queue log message:', err);
        }
      }
    },

    info(message, ...args) {
      if (!disableConsole) consoleLogger.info(message, ...args);
      
      if (levelPriority['info'] >= levelPriority[dbLogLevel]) {
        try {
          const details = args.length > 0 ? JSON.stringify(args, (key, value) => {
            if (value instanceof Error) {
              return { message: value.message, stack: value.stack, name: value.name };
            }
            if (typeof value === 'function') {
              return '[Function]';
            }
            // Add more checks for other complex types if necessary
            return value;
          }, 2) : null;
          loggingQueue.push({
            timestamp: new Date(),
            level: 'info',
            logger: name,
            message: String(message),
            details,
            service
          });
          
          processLoggingQueue();
        } catch (err) {
          consoleLogger.error('Failed to queue log message:', err);
        }
      }
    },

    warn(message, ...args) {
      if (!disableConsole) consoleLogger.warn(message, ...args);

      if (levelPriority['warn'] >= levelPriority[dbLogLevel]) {
        try {
          const details = args.length > 0 ? JSON.stringify(args, (key, value) => {
            if (value instanceof Error) {
              return { message: value.message, stack: value.stack, name: value.name };
            }
            if (typeof value === 'function') {
              return '[Function]';
            }
            // Add more checks for other complex types if necessary
            return value;
          }, 2) : null;
          loggingQueue.push({
            timestamp: new Date(),
            level: 'warn',
            logger: name,
            message: String(message),
            details,
            service
          });
          
          processLoggingQueue();
        } catch (err) {
          consoleLogger.error('Failed to queue log message:', err);
        }
      }
    },

    error(message, ...args) {
      if (!disableConsole) consoleLogger.error(message, ...args);

      if (levelPriority['error'] >= levelPriority[dbLogLevel]) {
        try {
          const details = args.length > 0 ? JSON.stringify(args, (key, value) => {
            if (value instanceof Error) {
              return { message: value.message, stack: value.stack, name: value.name };
            }
            if (typeof value === 'function') {
              return '[Function]';
            }
            // Add more checks for other complex types if necessary
            return value;
          }, 2) : null;
          loggingQueue.push({
            timestamp: new Date(),
            level: 'error',
            logger: name,
            message: String(message),
            details,
            service
          });
          
          processLoggingQueue();
        } catch (err) {
          consoleLogger.error('Failed to queue log message:', err);
        }
      }
    }
  };
}

export default createLogger;