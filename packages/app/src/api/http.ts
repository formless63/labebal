/**
 * Types shared by the API route modules under src/api. Each module exports
 * GET / POST / PUT / PATCH / DELETE handlers that take a standard `Request`
 * and a context with the path parameters, the same shape Next.js route
 * handlers use, so the same files run behind any server (see ./handler.ts).
 */
type ParamNames<S extends string> = S extends `${string}[${infer P}]${infer R}` ? P | ParamNames<R> : never;

/** Context passed to a route handler: `params` for a pattern like "/templates/[id]". */
export type Ctx<S extends string> = { params: Promise<{ [K in ParamNames<S>]: string }> };

export type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type Method = (typeof METHODS)[number];
export type RouteModule = Partial<Record<Method, RouteHandler>>;
