import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { PublicApiModule } from "./public-api.module.js";

// The OpenAPI document of the public /v1 API (F9), served at /v1/openapi.json and
// browsable at /v1/docs. Built from the decorators on V1Controller; the response
// shapes come straight from the Zod schemas in packages/schemas/src/public-api.ts
// (Zod implements "Standard JSON Schema", which @nestjs/swagger converts), so the
// document cannot drift from what the API checks before it answers.
//
// Only PublicApiModule is scanned, and its session routes (/api-keys) are excluded
// (@ApiExcludeController): the document describes what an API key can do, nothing else.

export const OPENAPI_JSON_PATH = "v1/openapi.json";
export const OPENAPI_UI_PATH = "v1/docs";

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Ledgerline public API")
    .setVersion("1")
    .setDescription(
      [
        "Read artist settlements and flag expenses for a person to review.",
        "",
        "Authenticate with an API key: `Authorization: Bearer ll_…`. A person creates keys in the web app; each key is shown once.",
        "",
        "Money is `{ cents, formatted }`: integer cents for programs, text such as `$1,234.56` to quote.",
        "",
        "This API cannot approve or pay a settlement. Only a logged-in person can.",
      ].join("\n"),
    )
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "ll_<prefix>_<secret>", // not a JWT, which is what Swagger assumes by default
        description: "An API key, created by a person in the web app",
      },
      "apiKey",
    )
    .build();
  return SwaggerModule.createDocument(app, config, { include: [PublicApiModule] });
}

// Swagger's routes are added to the HTTP server directly, not as Nest controllers, so
// the AuthGuard does not run on them: the document is public, like any API's docs.
// It contains no data, only the shapes.
export function serveOpenApiDocument(app: INestApplication): void {
  SwaggerModule.setup(OPENAPI_UI_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: OPENAPI_JSON_PATH,
    raw: ["json"], // no YAML copy
  });
}
