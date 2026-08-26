# Órdenes Ineco

App para cargar pacientes, médicos con firmas, generar órdenes e imprimirlas en PDF.

## Estructura

- `web/` — frontend React + Vite
- `api/` — backend Express + Firebase Firestore + firmas en disco

## Desarrollo local

```bash
npm run install:all

# Terminal 1 — API (puerto 3001 en api/.env)
npm run dev:api

# Terminal 2 — Web (puerto 5173)
npm run dev:web
```

La web en dev hace proxy de `/api` y `/uploads` hacia la API.

## Firebase (primera vez)

1. Publicar reglas de `api/firestore.rules` en Firebase Console → Firestore → Reglas
2. Importar datos iniciales:

```bash
cd api
npm run seed
```

Colecciones: `ordenes_medicos`, `ordenes_pacientes`, `ordenes_config`.

## Deploy en servidor (como ausentismo)

### 1. GitLab — build de imagen

1. El repo está en GitLab: `gitlab.com/ineco/administracion`
2. Habilitar Container Registry en el proyecto
3. Crear tag de release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

El pipeline `.gitlab-ci.yml` construye la imagen y la publica en el registry.

Variable opcional en GitLab CI/CD: `VITE_API_URL` vacía (ver `env.gitlab-ci.example`).

### 2. Servidor — levantar contenedor

En el servidor, junto a `docker-compose.yml`:

```bash
cp .env.example .env
# Completar FIREBASE_* y GITLAB_REGISTRY_IMAGE

docker compose pull
docker compose up -d
```

La app queda en `http://servidor:8081` (o el puerto definido en `APP_PORT`).

### Arquitectura del contenedor

```
nginx :80  →  /          → SPA (web/dist)
           →  /api/*     → Node :3000
           →  /uploads/* → Node :3000 (firmas)
           →  /health    → Node :3000
```

### Persistencia

| Dato | Dónde |
|---|---|
| Pacientes y médicos | Firebase Firestore |
| Firmas (imágenes) | Volumen `./uploads` → `/app/api/uploads` |

**Importante:** hacer backup de la carpeta `uploads/` del servidor. Sin ese volumen, las firmas se pierden al recrear el contenedor.

### Verificación

```bash
curl http://localhost:8081/health
curl http://localhost:8081/api/db
```

## Variables de entorno

**Desarrollo** (`api/.env`): ver `api/.env.example`

**Servidor** (`.env` en la raíz junto a docker-compose): ver `.env.example`

## Build local (sin Docker)

```bash
npm run build
```
