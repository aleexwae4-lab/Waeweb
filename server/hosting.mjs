// Fail closed for encrypted file stores when there is no guaranteed durable
// operator-managed disk. Hosted deployments must opt into verified PostgreSQL.
// No network calls, no assumptions based on user-supplied request headers.
export function requiresDurableStorage(env = process.env) {
  return env.NODE_ENV === "production" ||
    env.VERCEL === "1" || env.VERCEL === "true" ||
    env.RENDER === "true" || Boolean(env.RENDER_SERVICE_ID) ||
    Boolean(env.RENDER_EXTERNAL_HOSTNAME) ||
    Boolean(env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(env.K_SERVICE);
}
