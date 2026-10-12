export function redact(text:string){
  return text
    .replace(/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z ]+)?PRIVATE KEY-----|$)/g,'[REDACTED]')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,'[REDACTED]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|xox[baprs]-[a-zA-Z0-9-]+)\b/g,'[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi,'Bearer [REDACTED]')
    .replace(/((?:api[_-]?key|secret|password|access[_-]?token|client[_-]?secret)\s*[:=]\s*)[^\r\n,;]+/gi,'$1[REDACTED]');
}
