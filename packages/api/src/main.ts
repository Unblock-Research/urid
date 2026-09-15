import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  // rawBody: true preserves the exact request bytes on req.rawBody. DIDSig signs
  // sha256(rawBody), and re-serialising the parsed JSON would not reproduce the
  // client's bytes (key order, whitespace, number formatting), so every signed
  // request would fail verification.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost:4200"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  app.setGlobalPrefix("api");
  
  const config = new DocumentBuilder()
    .setTitle("URID API")
    .setDescription("Universal Researcher Identity API")
    .setVersion("1.0")
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, doc);
  
  await app.listen(3001);
  console.log("URID API running on http://localhost:3001");
  console.log("Swagger docs: http://localhost:3001/api/docs");
}
bootstrap();
