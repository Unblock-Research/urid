import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: ["http://localhost:3000", "http://localhost:4200"] });
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
