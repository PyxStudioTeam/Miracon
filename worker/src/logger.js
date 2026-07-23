import { errorDetails } from "./errors.js";

function write(level, message, fields = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const output = JSON.stringify(record);
  (level === "error" ? console.error : console.log)(output);
}

export const log = {
  info(message, fields) {
    write("info", message, fields);
  },
  warn(message, fields) {
    write("warn", message, fields);
  },
  error(message, error, fields = {}) {
    write("error", message, { ...fields, ...errorDetails(error) });
  },
};
