// 실행 환경 확인 - 브라우저인지 Node.js인지 구분
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// 로그 레벨을 가져오는 함수 - 환경에 따라 다르게 동작
function getLogLevel(defaultLevel = 'info') {
  try {
    if (isBrowser) {
      // 브라우저 환경
      return localStorage.getItem('logLevel') || defaultLevel;
    } else {
      // Node.js 환경 - 환경변수 또는 기본값 사용
      return process.env.LOG_LEVEL || defaultLevel;
    }
  } catch (error) {
    return defaultLevel; // 오류 발생시 기본값 반환
  }
}

// 로그 레벨 우선순위
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

// 로그를 출력해야 하는지 결정하는 함수
function shouldLog(level, configuredLevel) {
  try {
    const levelValue = LOG_LEVELS[level] || 0;
    const configuredValue = LOG_LEVELS[configuredLevel] || 0;
    return levelValue >= configuredValue;
  } catch (error) {
    return true; // 오류 발생시 항상 로그 출력
  }
}

// 로거 생성 함수
export function createLogger(name) {
  return {
    debug(message, ...args) {
      try {
        const logLevel = getLogLevel();
        if (shouldLog('debug', logLevel)) {
          console.debug(`[${name}] [DEBUG] ${message}`, ...args);
        }
      } catch (error) {
        console.debug(`[${name}] [DEBUG] ${message}`, ...args);
      }
    },
    info(message, ...args) {
      try {
        const logLevel = getLogLevel();
        if (shouldLog('info', logLevel)) {
          console.info(`[${name}] [INFO] ${message}`, ...args);
        }
      } catch (error) {
        console.info(`[${name}] [INFO] ${message}`, ...args);
      }
    },
    warn(message, ...args) {
      try {
        const logLevel = getLogLevel();
        if (shouldLog('warn', logLevel)) {
          console.warn(`[${name}] [WARN] ${message}`, ...args);
        }
      } catch (error) {
        console.warn(`[${name}] [WARN] ${message}`, ...args);
      }
    },
    error(message, ...args) {
      try {
        const logLevel = getLogLevel();
        if (shouldLog('error', logLevel)) {
          console.error(`[${name}] [ERROR] ${message}`, ...args);
        }
      } catch (error) {
        console.error(`[${name}] [ERROR] ${message}`, ...args);
      }
    }
  };
}

// default export 추가
export default createLogger;