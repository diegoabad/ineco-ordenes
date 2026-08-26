import app from "./app.js";
import { env } from "./config/env.js";

app.listen(env.port, () => {
  console.log(`API corriendo en http://localhost:${env.port}`);
  console.log(`Health: GET http://localhost:${env.port}/health`);
  console.log(`Datos:  GET http://localhost:${env.port}/api/db`);
});
